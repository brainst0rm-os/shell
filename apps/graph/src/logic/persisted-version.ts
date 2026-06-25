/**
 * Persisted-state acceptance predicate for the Graph app's `graph:state`
 * payload.
 *
 * History: the loader gated restore on an explicit version allowlist
 * (`version === 1 || 2 || 3`). When the payload schema moved to v4
 * (pattern stored inline) and v5 (local depth/direction), the allowlist
 * was never widened — so every payload written by a current build was
 * silently discarded on reload and the user lost their pattern, pinned
 * positions, camera, and local view. `applyPersistedState` is already
 * migration-tolerant (missing keys fall back to current defaults), so
 * the right rule is "restore any payload that carries a sane version",
 * not a hand-maintained allowlist that rots on every schema bump.
 *
 * Pure: no DOM, no storage — unit-testable; the loader just calls it.
 */

/** Newest schema version the app writes. Bump in lockstep with
 *  `PersistedState.version` in `app.ts`. Informational only — a payload
 *  from a *newer* build (downgrade) is still restored, because the
 *  tolerant applier ignores unknown keys and defaults missing ones,
 *  which beats throwing away all of the user's state. */
export const CURRENT_PERSISTED_VERSION = 8;

/** True when `raw` is a usable persisted payload: a non-null object
 *  whose `version` is a finite number ≥ 1. Anything else (null, a
 *  primitive, a missing/garbage version) is rejected so a corrupt disk
 *  row can't drive the loader. */
export function shouldRestorePersisted(raw: unknown): boolean {
	if (raw === null || typeof raw !== "object") return false;
	const version = (raw as { version?: unknown }).version;
	return typeof version === "number" && Number.isFinite(version) && version >= 1;
}
