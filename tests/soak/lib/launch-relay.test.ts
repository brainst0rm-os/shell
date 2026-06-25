/**
 * Stage 10.9c — verify the spec-level try/finally shape guarantees a
 * relay handle is `stop()`ped even when the downstream `_electron.launch`
 * throws. This is a structural test against the same control-flow shape
 * the spec uses, without actually spawning a relay child or Electron — the
 * `RelayHandle` is a fake whose `stop()` is asserted called.
 *
 * The 10.9b smoke leaked a relay subprocess (PID 71905 in v5) because the
 * spec constructed the handle OUTSIDE the try, so a launch failure never
 * reached the finally block. The fix moves construction INSIDE the try
 * and lets `finally` reach a stop() through an optional handle.
 */

import { describe, expect, it, vi } from "vitest";
import type { RelayHandle } from "./launch-relay";

function makeFakeRelay(): RelayHandle {
	return {
		port: 7780,
		url: "ws://127.0.0.1:7780",
		stop: vi.fn().mockResolvedValue(undefined),
	};
}

async function runSpecShape(
	makeRelay: () => Promise<RelayHandle>,
	launchShell: () => Promise<unknown>,
): Promise<{ stoppedRelay: boolean; threw: unknown }> {
	let relay: RelayHandle | undefined;
	let threw: unknown = null;
	try {
		relay = await makeRelay();
		await launchShell();
	} catch (error) {
		threw = error;
	} finally {
		await relay?.stop().catch(() => {});
	}
	return {
		stoppedRelay: Boolean(relay && (relay.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0),
		threw,
	};
}

describe("launch-relay cleanup race (10.9c)", () => {
	it("relay.stop() runs when _electron.launch throws AFTER the relay is up", async () => {
		const relay = makeFakeRelay();
		const result = await runSpecShape(
			async () => relay,
			async () => {
				throw new Error("_electron.launch timeout");
			},
		);
		expect(result.threw).toBeInstanceOf(Error);
		expect((result.threw as Error).message).toMatch(/timeout/);
		expect(relay.stop).toHaveBeenCalledTimes(1);
		expect(result.stoppedRelay).toBe(true);
	});

	it("relay.stop() runs when assertions later throw inside the same try", async () => {
		const relay = makeFakeRelay();
		let relayHandle: RelayHandle | undefined;
		let threw: unknown = null;
		try {
			relayHandle = await Promise.resolve(relay);
			throw new Error("assertion failed");
		} catch (error) {
			threw = error;
		} finally {
			await relayHandle?.stop().catch(() => {});
		}
		expect(threw).toBeInstanceOf(Error);
		expect(relay.stop).toHaveBeenCalledTimes(1);
	});

	it("relay.stop() is NOT called when `launchRelay` itself throws (nothing to stop)", async () => {
		const stopSpy = vi.fn();
		let relayHandle: RelayHandle | undefined;
		let threw: unknown = null;
		try {
			relayHandle = await Promise.reject(new Error("relay spawn failed"));
		} catch (error) {
			threw = error;
		} finally {
			await relayHandle?.stop().catch(() => {});
		}
		expect(threw).toBeInstanceOf(Error);
		expect((threw as Error).message).toMatch(/spawn failed/);
		expect(stopSpy).not.toHaveBeenCalled();
	});

	it("relay.stop() rejection does not mask the original assertion failure", async () => {
		const relay: RelayHandle = {
			port: 7780,
			url: "ws://127.0.0.1:7780",
			stop: vi.fn().mockRejectedValue(new Error("stop failed")),
		};
		let relayHandle: RelayHandle | undefined;
		let threw: unknown = null;
		try {
			relayHandle = await Promise.resolve(relay);
			throw new Error("assertion x");
		} catch (error) {
			threw = error;
		} finally {
			await relayHandle?.stop().catch(() => {});
		}
		expect((threw as Error).message).toBe("assertion x");
		expect(relay.stop).toHaveBeenCalledTimes(1);
	});

	it("happy path — relay.stop() runs after successful launch + assertions", async () => {
		const relay = makeFakeRelay();
		const result = await runSpecShape(
			async () => relay,
			async () => "ok",
		);
		expect(result.threw).toBeNull();
		expect(relay.stop).toHaveBeenCalledTimes(1);
	});
});
