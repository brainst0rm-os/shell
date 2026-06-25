import { describe, expect, it, vi } from "vitest";
import { ENVELOPE_PROTOCOL_VERSION, type Envelope, type EnvelopeReply } from "../ipc/envelope";
import { installWorkerProcessGuards, wireParentPort } from "./worker-runtime";

function fakeProc() {
	const listeners = new Map<string, (arg: unknown) => void>();
	return {
		on(event: string, listener: (arg: unknown) => void) {
			listeners.set(event, listener);
			return this;
		},
		exit: vi.fn(),
		emit(event: string, arg: unknown) {
			listeners.get(event)?.(arg);
		},
		has: (event: string) => listeners.has(event),
	};
}

function fakePort() {
	let onMessage: ((event: { data: unknown }) => void) | null = null;
	const posted: EnvelopeReply[] = [];
	return {
		on: (_event: "message", listener: (event: { data: unknown }) => void) => {
			onMessage = listener;
		},
		postMessage: (m: unknown) => posted.push(m as EnvelopeReply),
		deliver: (data: unknown) => onMessage?.({ data }),
		posted,
	};
}

function envelope(msg: string): Envelope {
	return {
		v: ENVELOPE_PROTOCOL_VERSION,
		msg,
		app: "_shell",
		service: "ydoc",
		method: "x",
		args: [],
		caps: [],
	};
}

describe("installWorkerProcessGuards", () => {
	it("logs an unhandled rejection but does NOT exit (a stray reject must not kill the worker)", () => {
		const proc = fakeProc();
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		installWorkerProcessGuards("ydoc", proc);

		proc.emit("unhandledRejection", new Error("boom"));

		expect(proc.exit).not.toHaveBeenCalled();
		expect(err).toHaveBeenCalled();
		expect(err.mock.calls[0]?.[0]).toContain("ydoc");
		err.mockRestore();
	});

	it("logs an uncaught exception and exits so the supervisor respawns", () => {
		const proc = fakeProc();
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		installWorkerProcessGuards("storage", proc);

		proc.emit("uncaughtException", new Error("fatal"));

		expect(proc.exit).toHaveBeenCalledWith(1);
		expect(err.mock.calls[0]?.[0]).toContain("storage");
		err.mockRestore();
	});
});

describe("wireParentPort", () => {
	it("forwards a message to the handler and posts its reply", async () => {
		const port = fakePort();
		const handle = vi.fn(async (event: { data: unknown }) => {
			const e = event.data as Envelope;
			return { v: ENVELOPE_PROTOCOL_VERSION, msg: e.msg, ok: true, value: "ok" } as EnvelopeReply;
		});
		wireParentPort("ydoc", handle, port);

		port.deliver(envelope("m1"));
		await Promise.resolve();
		await Promise.resolve();

		expect(port.posted).toHaveLength(1);
		expect(port.posted[0]?.msg).toBe("m1");
	});

	it("does not throw out of the listener when the handler rejects — posts an error reply", async () => {
		const port = fakePort();
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const handle = vi.fn(async () => {
			throw new Error("handler blew up");
		});
		wireParentPort("ydoc", handle, port);

		expect(() => port.deliver(envelope("m2"))).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();

		expect(port.posted).toHaveLength(1);
		const reply = port.posted[0];
		expect(reply?.ok).toBe(false);
		if (reply && !reply.ok) {
			expect(reply.msg).toBe("m2");
			// The reply crosses to a sandboxed renderer — it must be generic, not
			// the raw error text (which can carry a main-process path).
			expect(reply.error.message).toBe("worker request failed");
			expect(reply.error.message).not.toContain("handler blew up");
		}
		// Full detail is still logged locally.
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});

	it("is a no-op when there is no parent port (Vitest / headless)", () => {
		expect(() => wireParentPort("ydoc", vi.fn(), undefined)).not.toThrow();
	});
});
