/**
 * 9.13.10c — typed `HistoryAnimationState` persistence.
 *
 * The scrubber's position (cutoff), playback speed and reveal mode used
 * to evaporate on every Graph reopen — `loadVaultEntities` resets
 * `cutoffAt` to null and nothing carried it across reloads. This is the
 * pure (de)serialiser for the documented `HistoryAnimationState` shape
 * (`types/graph-view.ts`), so the Graph round-trips the user's place in
 * the timeline through `graph:state`.
 *
 * `restoreHistoryState` is **tolerant**: any field that is missing or
 * the wrong type falls back to the default rather than throwing — a
 * legacy / hand-edited / future payload still loads (mirrors
 * `applyPersistedState`'s migration-tolerant contract). `captureHistory`
 * derives the immutable bits (`enabled`, `startAt`, `endAt`) from live
 * runtime values so the persisted block is always internally
 * consistent. Pure + dependency-free → unit-tested without the app.
 */

import { type HistoryAnimationState, HistoryReveal } from "../types/graph-view";

export const DEFAULT_HISTORY_ANIMATION_STATE: HistoryAnimationState = {
	enabled: false,
	startAt: null,
	endAt: null,
	cutoffAt: null,
	speed: 1,
	reveal: HistoryReveal.Eased,
};

const REVEALS: ReadonlySet<string> = new Set(Object.values(HistoryReveal));

function numberOrNull(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse a persisted `history` blob back into a valid
 * `HistoryAnimationState`. Unknown / malformed input → the default
 * (history off), never a throw. `enabled` is *derived* from `cutoffAt`
 * (a non-null cutoff is what "history is on" means) so a stale `enabled`
 * flag can't disagree with the cutoff.
 */
export function restoreHistoryState(raw: unknown): HistoryAnimationState {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_HISTORY_ANIMATION_STATE };
	const r = raw as Record<string, unknown>;
	const cutoffAt = numberOrNull(r.cutoffAt);
	const speed = typeof r.speed === "number" && Number.isFinite(r.speed) && r.speed > 0 ? r.speed : 1;
	const reveal =
		typeof r.reveal === "string" && REVEALS.has(r.reveal)
			? (r.reveal as HistoryReveal)
			: HistoryReveal.Eased;
	return {
		enabled: cutoffAt !== null,
		startAt: numberOrNull(r.startAt),
		endAt: numberOrNull(r.endAt),
		cutoffAt,
		speed,
		reveal,
	};
}

/**
 * Build the `HistoryAnimationState` to persist from the app's live
 * scrubber fields + the current scene bounds. `enabled` mirrors
 * `cutoffAt !== null`; `startAt`/`endAt` snapshot the timeline extent so
 * a future read knows the range the cutoff was relative to.
 */
export function captureHistoryState(input: {
	cutoffAt: number | null;
	speed: number;
	reveal: HistoryReveal;
	bounds: { min: number; max: number } | null;
}): HistoryAnimationState {
	const speed =
		typeof input.speed === "number" && Number.isFinite(input.speed) && input.speed > 0
			? input.speed
			: 1;
	return {
		enabled: input.cutoffAt !== null,
		startAt: input.bounds ? input.bounds.min : null,
		endAt: input.bounds ? input.bounds.max : null,
		cutoffAt: numberOrNull(input.cutoffAt),
		speed,
		reveal: REVEALS.has(input.reveal) ? input.reveal : HistoryReveal.Eased,
	};
}
