/**
 * Stage 10.14 — module-level holder for the active session's `RestoreEngine`,
 * mirroring `live-sync-wiring.ts`. The engine is rebuilt per vault session (its
 * account key + relay binding are session-scoped); the `sync-status:*` IPC
 * handlers read the current one through `getRestoreEngine()` so they always
 * address the live session without re-binding.
 */

import type { RestoreEngine } from "./restore-engine";

let current: RestoreEngine | null = null;

export function setRestoreEngine(engine: RestoreEngine | null): void {
	current = engine;
}

export function getRestoreEngine(): RestoreEngine | null {
	return current;
}
