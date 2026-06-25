/**
 * Stage 10.12 — module-level lifecycle for the always-on `LiveSyncEngine`.
 *
 * The engine's context (DEK store, sovereign key, sign closure) is per vault
 * session, so the engine is rebuilt on every session activation and disposed
 * on deactivation. The entities-service hooks (`onDocOpened` /
 * `onLocalDocUpdate`) read the *current* engine through `getLiveSyncEngine()`,
 * so they always address the live session's engine without re-binding.
 */

import { LiveSyncEngine, type LiveSyncEngineContext } from "./live-sync-engine";

let current: LiveSyncEngine | null = null;

/** Dispose any prior engine, build + start a fresh one for the now-active
 *  session, and make it the current engine. */
export function installLiveSyncEngine(ctx: LiveSyncEngineContext): LiveSyncEngine {
	disposeLiveSyncEngine();
	const engine = new LiveSyncEngine(ctx);
	engine.start();
	current = engine;
	return engine;
}

/** The engine for the active session, or null when no vault is open. */
export function getLiveSyncEngine(): LiveSyncEngine | null {
	return current;
}

export function disposeLiveSyncEngine(): void {
	if (!current) return;
	current.dispose();
	current = null;
}
