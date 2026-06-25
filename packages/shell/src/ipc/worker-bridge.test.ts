import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENVELOPE_PROTOCOL_VERSION, makeEnvelope } from "./envelope";
import { type DuplexPort, WorkerBridge } from "./worker-bridge";

type Listener = (data: unknown) => void;

class FakePort implements DuplexPort {
	private readonly listeners = new Set<Listener>();
	readonly outbound: unknown[] = [];
	closed = false;
	postMessage(message: unknown): void {
		this.outbound.push(message);
	}
	on(_event: "message", listener: Listener): void {
		this.listeners.add(listener);
	}
	off(_event: "message", listener: Listener): void {
		this.listeners.delete(listener);
	}
	close(): void {
		this.closed = true;
	}
	emit(reply: unknown): void {
		for (const listener of this.listeners) listener(reply);
	}
}

function mkEnvelope(msg: string) {
	return makeEnvelope({
		msg,
		app: "io.example.app",
		service: "storage",
		method: "ping",
		args: [],
		caps: [],
	});
}

describe("WorkerBridge", () => {
	let port: FakePort;
	let bridge: WorkerBridge;

	beforeEach(() => {
		port = new FakePort();
		bridge = new WorkerBridge(port);
	});

	afterEach(() => {
		bridge.dispose();
	});

	it("forwards envelopes to the port", async () => {
		void bridge.send(mkEnvelope("m1"));
		expect(port.outbound).toHaveLength(1);
		expect((port.outbound[0] as { msg: string }).msg).toBe("m1");
	});

	it("resolves the promise when a matching reply arrives", async () => {
		const promise = bridge.send(mkEnvelope("m1"));
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m1", ok: true, value: 42 });
		const reply = await promise;
		expect(reply.ok).toBe(true);
		expect(reply.ok === true && reply.value).toBe(42);
	});

	it("matches reply by msg id, ignoring out-of-order replies", async () => {
		const p1 = bridge.send(mkEnvelope("m1"));
		const p2 = bridge.send(mkEnvelope("m2"));
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m2", ok: true, value: "B" });
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m1", ok: true, value: "A" });
		await expect(p1).resolves.toMatchObject({ ok: true, value: "A" });
		await expect(p2).resolves.toMatchObject({ ok: true, value: "B" });
	});

	it("ignores replies for unknown msg ids", async () => {
		const promise = bridge.send(mkEnvelope("m1"));
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "stranger", ok: true, value: 0 });
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m1", ok: true, value: "ours" });
		const reply = await promise;
		expect(reply.ok === true && reply.value).toBe("ours");
	});

	it("ignores reply-shaped messages with wrong protocol version", async () => {
		vi.useFakeTimers();
		const promise = bridge.send(mkEnvelope("m1"), { timeoutMs: 50 });
		port.emit({ v: 99, msg: "m1", ok: true, value: "wrong-version" });
		vi.advanceTimersByTime(60);
		await expect(promise).rejects.toThrow(/timeout/);
		vi.useRealTimers();
	});

	it("times out when no reply arrives", async () => {
		vi.useFakeTimers();
		const promise = bridge.send(mkEnvelope("m1"), { timeoutMs: 100 });
		vi.advanceTimersByTime(150);
		await expect(promise).rejects.toThrow(/timeout/);
		vi.useRealTimers();
	});

	it("resolves in-flight sends with Unavailable on dispose", async () => {
		const promise = bridge.send(mkEnvelope("m1"));
		bridge.dispose();
		const reply = await promise;
		expect(reply.ok).toBe(false);
		expect(reply.ok === false && reply.error.kind).toBe("Unavailable");
	});

	it("rejects send() after dispose", async () => {
		bridge.dispose();
		await expect(bridge.send(mkEnvelope("m1"))).rejects.toThrow(/disposed/);
	});

	it("removes the listener and closes the port on dispose", () => {
		bridge.dispose();
		expect(port.closed).toBe(true);
	});

	it("ignores non-reply-shaped messages without breaking the bridge", async () => {
		const promise = bridge.send(mkEnvelope("m1"));
		port.emit("garbage");
		port.emit(null);
		port.emit({ msg: "m1" });
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m1", ok: "neither" });
		port.emit({ v: ENVELOPE_PROTOCOL_VERSION, msg: "m1", ok: true, value: "good" });
		const reply = await promise;
		expect(reply.ok === true && reply.value).toBe("good");
	});

	it("propagates postMessage errors to the caller", async () => {
		const breakingPort: DuplexPort = {
			postMessage: () => {
				throw new Error("port full");
			},
			on: () => undefined,
			off: () => undefined,
		};
		const localBridge = new WorkerBridge(breakingPort);
		await expect(localBridge.send(mkEnvelope("m1"))).rejects.toThrow(/port full/);
		localBridge.dispose();
	});
});
