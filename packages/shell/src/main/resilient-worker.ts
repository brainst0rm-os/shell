/**
 * Resilient worker supervisor — keeps a `utilityProcess` worker alive across
 * crashes, per §Crash recovery:
 * "Worker crash: shell respawns the worker … apps may briefly see
 * `Unavailable` for that service."
 *
 * Two failures it closes, both of which previously surfaced as a frozen app:
 *   1. **Dead-worker hang.** A bare `WorkerBridge` only learns a request
 *      failed via its 30s timeout. When the worker process dies, every
 *      in-flight + subsequent call would sit out the full 30s before
 *      rejecting. Here the exit listener disposes the bridge immediately, so
 *      pending calls fail FAST with `Unavailable` and new calls hit a fresh
 *      worker.
 *   2. **No recovery.** A crashed worker stayed dead until the next app
 *      restart. Here it's respawned (bounded by a crash-loop guard so a
 *      worker that crashes on boot can't peg the CPU), and `onRespawn` lets
 *      the caller re-establish per-worker session state (storage `setVault`).
 *
 * Dependency-injected (spawn factory, app-ready predicate, clock) so the
 * supervision logic is unit-testable without Electron.
 */

import type { Envelope, EnvelopeReply } from "../ipc/envelope";
import { type DuplexPort, WorkerBridge } from "../ipc/worker-bridge";

/** The slice of Electron's `UtilityProcess` the supervisor drives. */
export type SupervisedProcess = {
	port: DuplexPort;
	/** Register the process-exit listener (called once per spawned process). */
	onExit: (listener: (code: number) => void) => void;
	kill: () => void;
};

export type ResilientWorkerOptions = {
	/** Fork a fresh worker process. Called once on creation, then once per
	 *  respawn. */
	spawn: () => SupervisedProcess;
	/** Whether the app is live. An exit before ready (early boot) or after
	 *  `dispose()` is not resurrected; an exit while ready triggers respawn. */
	isAppReady: () => boolean;
	/** Fired after a respawn (never the initial spawn), once the new bridge is
	 *  live, so the caller can re-bind per-worker session state. Best-effort. */
	onRespawn?: () => void;
	/** Diagnostic sink for the "worker exited" line. `willRespawn` is false on
	 *  give-up / not-ready / early-boot. */
	onExitLog?: (code: number, willRespawn: boolean) => void;
	/** Fired once when the crash-loop guard trips and the supervisor stops
	 *  resurrecting the worker. `windowMs` is the crash-loop window the count
	 *  was measured over, so the caller's log can't drift from the constant. */
	onGiveUp?: (crashesInWindow: number, windowMs: number) => void;
	/** Injectable clock for the crash-loop window (defaults to `Date.now`). */
	now?: () => number;
	bridgeOptions?: { defaultTimeoutMs?: number };
};

export type ResilientWorker = {
	send(envelope: Envelope, options?: { timeoutMs?: number }): Promise<EnvelopeReply>;
	dispose(): void;
};

/** A worker that crashes more than this many times inside the window is in a
 *  crash loop; stop respawning so it can't hot-loop the CPU. Calls then fail
 *  fast with `Unavailable` until the next app restart. */
const RESPAWN_WINDOW_MS = 10_000;
const MAX_RESPAWNS_IN_WINDOW = 5;

export function createResilientWorker(options: ResilientWorkerOptions): ResilientWorker {
	const now = options.now ?? (() => Date.now());
	let bridge: WorkerBridge;
	let proc: SupervisedProcess;
	let disposed = false;
	let crashes: number[] = [];

	const start = (): void => {
		proc = options.spawn();
		bridge = new WorkerBridge(proc.port, options.bridgeOptions ?? {});
		proc.onExit((code) => {
			if (disposed) return;
			// Fail in-flight + queued requests immediately (Unavailable) rather
			// than letting them wait out the 30s bridge timeout.
			bridge.dispose();
			if (!options.isAppReady()) {
				options.onExitLog?.(code, false);
				return;
			}
			const t = now();
			crashes = crashes.filter((ts) => t - ts < RESPAWN_WINDOW_MS);
			crashes.push(t);
			if (crashes.length > MAX_RESPAWNS_IN_WINDOW) {
				options.onExitLog?.(code, false);
				options.onGiveUp?.(crashes.length, RESPAWN_WINDOW_MS);
				return;
			}
			options.onExitLog?.(code, true);
			start();
			options.onRespawn?.();
		});
	};

	start();

	return {
		send: (envelope, sendOptions) => bridge.send(envelope, sendOptions),
		dispose: () => {
			disposed = true;
			bridge.dispose();
			proc.kill();
		},
	};
}
