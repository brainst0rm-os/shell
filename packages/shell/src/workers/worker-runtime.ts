/**
 * Shared worker-process hardening for the storage / ydoc / extraction
 * utilityProcess workers.
 *
 * The bug this closes: the workers had NO process-level error handlers, so a
 * single stray unhandled rejection (a fire-and-forget write, an idle-reaper
 * timer, a non-cloneable `postMessage`) or any uncaught throw terminated the
 * whole worker with a bare non-zero exit code and NO captured stack — the
 * "exited with code 2" lines in the error log, with nothing explaining why.
 * Combined with the (now-fixed) no-respawn supervisor, that froze the app.
 *
 *   - `installWorkerProcessGuards` — `unhandledRejection` logs a full stack
 *     and KEEPS RUNNING (one bad async path must not down a worker serving
 *     every other entity; Node's default would terminate). `uncaughtException`
 *     logs and exits(1) — continuing past a true uncaught exception is unsafe,
 *     and the shell's resilient-worker supervisor respawns a clean process.
 *   - `wireParentPort` — the one safe `parentPort` message listener, shared
 *     across all three workers (was copy-pasted three times). Its body can't
 *     throw out of the async listener: a handler reject or a `postMessage`
 *     failure is logged and best-effort answered with an error reply so the
 *     caller fails fast instead of waiting out the bridge timeout.
 *
 * Logs go to stderr; the shell pipes worker stdio into ~/.brainstorm/logs.
 */

import { type EnvelopeReply, makeErrorReply } from "../ipc/envelope";

/** The slice of `process` the guards touch — injectable so the install logic
 *  is unit-testable without registering real process handlers. */
export type WorkerProcessLike = {
	on(event: string, listener: (arg: unknown) => void): unknown;
	exit?(code?: number): void;
};

/** The slice of Electron's `parentPort` the listener touches. */
export type ParentPortLike = {
	on(event: "message", listener: (event: { data: unknown }) => void): void;
	postMessage(message: unknown): void;
};

export function logWorkerError(name: string, kind: string, err: unknown): void {
	const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
	try {
		console.error(`[brainstorm:worker:${name}] ${kind}: ${detail}`);
	} catch {
		// best-effort: never throw out of the error path.
	}
}

export function installWorkerProcessGuards(name: string, proc: WorkerProcessLike = process): void {
	proc.on("unhandledRejection", (reason: unknown) => {
		logWorkerError(name, "unhandledRejection", reason);
		// Deliberately do NOT exit — a stray rejection must not take down a
		// worker that is otherwise serving every other request.
	});
	proc.on("uncaughtException", (err: unknown) => {
		logWorkerError(name, "uncaughtException", err);
		// Unsafe to continue past a true uncaught exception; exit so the
		// resilient-worker supervisor respawns a clean process.
		proc.exit?.(1);
	});
}

function messageIdOf(data: unknown): string {
	if (data && typeof data === "object") {
		const m = (data as { msg?: unknown }).msg;
		if (typeof m === "string" && m.length > 0 && m.length <= 128) return m;
	}
	return "unknown";
}

export function wireParentPort(
	name: string,
	handle: (event: { data: unknown }) => Promise<EnvelopeReply>,
	port: ParentPortLike | undefined,
): void {
	if (!port) return;
	port.on("message", (event) => {
		void (async () => {
			try {
				const reply = await handle(event);
				port.postMessage(reply);
			} catch (err) {
				logWorkerError(name, "message-handler", err);
				// Best-effort error reply so the caller fails fast rather than
				// waiting out the 30s bridge timeout. If even this throws (e.g.
				// a non-cloneable structured clone), swallow it — the supervisor
				// + bridge timeout are the backstop.
				//
				// The reply crosses to a sandboxed app renderer, so it carries a
				// GENERIC message — the raw `err.message` can hold a main-process
				// absolute path (e.g. an fs error from ydoc-store) an app must
				// not see. Full detail is in the local log (`logWorkerError`
				// above); the app only needs to know the request failed.
				try {
					port.postMessage(
						makeErrorReply(messageIdOf(event?.data), {
							kind: "Internal",
							message: "worker request failed",
						}),
					);
				} catch {
					// give up; do not crash the worker.
				}
			}
		})();
	});
}
