import { describe, expect, it, vi } from "vitest";
import { ENVELOPE_PROTOCOL_VERSION, type Envelope } from "../ipc/envelope";
import type { DuplexPort } from "../ipc/worker-bridge";
import { type SupervisedProcess, createResilientWorker } from "./resilient-worker";

function envelope(msg: string): Envelope {
	return {
		v: ENVELOPE_PROTOCOL_VERSION,
		msg,
		app: "_shell",
		service: "storage",
		method: "ping",
		args: [],
		caps: [],
	};
}

/** A controllable fake worker process: capture the bridge's message listener
 *  and exit listener so a test can push replies and simulate a crash. */
function fakeProcess() {
	let onMessage: ((data: unknown) => void) | null = null;
	let onExit: ((code: number) => void) | null = null;
	const posted: Envelope[] = [];
	let killed = false;

	const port: DuplexPort = {
		postMessage: (m) => posted.push(m as Envelope),
		on: (_event, listener) => {
			onMessage = listener;
		},
		off: () => {},
		close: () => {},
	};
	const proc: SupervisedProcess = {
		port,
		onExit: (listener) => {
			onExit = listener;
		},
		kill: () => {
			killed = true;
		},
	};
	return {
		proc,
		posted,
		isKilled: () => killed,
		reply: (msg: string, value: unknown) =>
			onMessage?.({ v: ENVELOPE_PROTOCOL_VERSION, msg, ok: true, value }),
		crash: (code = 2) => onExit?.(code),
	};
}

/** A spawn factory that hands out a fresh fakeProcess each call and records
 *  them, so a test can drive respawned generations. */
function spawnSequence() {
	const generations: ReturnType<typeof fakeProcess>[] = [];
	return {
		generations,
		spawn: () => {
			const g = fakeProcess();
			generations.push(g);
			return g.proc;
		},
	};
}

describe("createResilientWorker", () => {
	it("forwards sends to the live worker and resolves on reply", async () => {
		const seq = spawnSequence();
		const worker = createResilientWorker({ spawn: seq.spawn, isAppReady: () => true });

		const pending = worker.send(envelope("m1"));
		expect(seq.generations[0]?.posted.map((e) => e.msg)).toEqual(["m1"]);
		seq.generations[0]?.reply("m1", "pong");

		const reply = await pending;
		expect(reply.ok && reply.value).toBe("pong");
		worker.dispose();
	});

	it("fails in-flight requests FAST with Unavailable when the worker dies (no 30s hang)", async () => {
		const seq = spawnSequence();
		const worker = createResilientWorker({ spawn: seq.spawn, isAppReady: () => true });

		const pending = worker.send(envelope("m1")); // in flight, no reply
		seq.generations[0]?.crash(2); // worker dies

		const reply = await pending; // resolves immediately, not after the 30s timeout
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Unavailable");
		worker.dispose();
	});

	it("respawns on crash and routes new sends to the fresh worker", async () => {
		const seq = spawnSequence();
		const onRespawn = vi.fn();
		const worker = createResilientWorker({ spawn: seq.spawn, isAppReady: () => true, onRespawn });

		seq.generations[0]?.crash(2);
		expect(seq.generations).toHaveLength(2); // respawned
		expect(onRespawn).toHaveBeenCalledTimes(1);

		const pending = worker.send(envelope("m2"));
		expect(seq.generations[1]?.posted.map((e) => e.msg)).toEqual(["m2"]); // hit gen 2
		expect(seq.generations[0]?.posted.map((e) => e.msg)).toEqual([]); // not the dead one
		seq.generations[1]?.reply("m2", "ok");
		expect((await pending).ok).toBe(true);
		worker.dispose();
	});

	it("does NOT respawn after dispose (clean shutdown)", () => {
		const seq = spawnSequence();
		const worker = createResilientWorker({ spawn: seq.spawn, isAppReady: () => true });

		worker.dispose();
		expect(seq.generations[0]?.isKilled()).toBe(true);
		seq.generations[0]?.crash(0); // the kill triggers exit
		expect(seq.generations).toHaveLength(1); // no resurrection
	});

	it("does NOT respawn when the app is not ready (early-boot crash)", () => {
		const seq = spawnSequence();
		createResilientWorker({ spawn: seq.spawn, isAppReady: () => false });

		seq.generations[0]?.crash(1);
		expect(seq.generations).toHaveLength(1);
	});

	it("gives up after a crash loop instead of respawning forever", () => {
		const seq = spawnSequence();
		let clock = 0;
		const onGiveUp = vi.fn();
		createResilientWorker({
			spawn: seq.spawn,
			isAppReady: () => true,
			now: () => clock,
			onGiveUp,
		});

		// Six crashes inside the 10s window: 5 respawns, then give up.
		for (let i = 0; i < 6; i++) {
			clock += 100;
			seq.generations.at(-1)?.crash(2);
		}
		expect(onGiveUp).toHaveBeenCalledTimes(1);
		// Reports the crash count AND the window it was measured over, so the
		// caller's log can't drift from RESPAWN_WINDOW_MS.
		expect(onGiveUp).toHaveBeenCalledWith(6, 10_000);
		// 1 initial + 5 respawns = 6 generations; the 6th crash does not respawn.
		expect(seq.generations).toHaveLength(6);
	});

	it("resets the crash-loop counter once crashes age out of the window", () => {
		const seq = spawnSequence();
		let clock = 0;
		createResilientWorker({ spawn: seq.spawn, isAppReady: () => true, now: () => clock });

		for (let i = 0; i < 4; i++) {
			clock += 100;
			seq.generations.at(-1)?.crash(2);
		}
		clock += 20_000; // far past the window
		seq.generations.at(-1)?.crash(2);
		// Still respawning — the earlier burst aged out, so this isn't a loop.
		expect(seq.generations.length).toBeGreaterThan(5);
	});
});
