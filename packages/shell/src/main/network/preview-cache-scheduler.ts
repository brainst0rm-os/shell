/**
 * Net-1c — periodic prune scheduler for `LinkPreviewCache`.
 *
 * The cache's lazy `get`-time prune already handles cold reads (an
 * expired entry returns null and is dropped in place). But entries
 * that never get re-read sit in memory until the LRU cap evicts them
 * — a long-running shell can accumulate megabytes of stale previews
 * the user will never re-paste. This scheduler runs `cache.prune()`
 * on a fixed interval (30 min default) so memory stays tidy without
 * waiting for cap pressure.
 *
 * Pure-ish: the constructor takes a `setInterval` / `clearInterval`
 * injection so unit tests don't need fake timers (just a manual
 * tick-on-demand stub). Production binds the global `setInterval`.
 */

import type { LinkPreviewCache } from "./preview-cache";

/** Default prune interval — 30 minutes. Chosen so it's well shorter
 *  than the 24h TTL (entries don't pile up for a full day) but long
 *  enough that the prune walk doesn't waste CPU on a quiet vault.
 *  Each prune is O(n) over the cache, capped at MAX_ENTRIES (1024)
 *  so the wall-clock cost is microseconds. */
export const DEFAULT_PRUNE_INTERVAL_MS = 30 * 60 * 1000;

/** Injectable timer factory. `set` returns an opaque handle that
 *  `clear` cancels. Production passes `setInterval` / `clearInterval`
 *  directly; tests pass a manual ticker. */
export type IntervalFactory = {
	set: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
	clear: (handle: ReturnType<typeof setInterval>) => void;
};

/** Default factory — production wiring. Forwarding wrappers keep the
 *  factory shape stable (Node's `setInterval` returns `Timeout` whose
 *  exact type we don't want leaking through the public API). */
export const productionIntervalFactory: IntervalFactory = {
	set: (handler, ms) => setInterval(handler, ms),
	clear: (handle) => clearInterval(handle),
};

export type PreviewCacheSchedulerOptions = {
	/** Cache instance to prune. */
	readonly cache: LinkPreviewCache;
	/** Interval between prunes. Defaults to 30 minutes. */
	readonly intervalMs?: number;
	/** Injectable timer factory — defaults to `setInterval` /
	 *  `clearInterval`. Tests inject a manual ticker. */
	readonly intervals?: IntervalFactory;
};

/** Schedule periodic `cache.prune()` calls. Returns a `stop()` so the
 *  caller can dispose on shutdown / vault close. Idempotent stop —
 *  calling `stop()` twice is safe. */
export function schedulePreviewCachePrune(options: PreviewCacheSchedulerOptions): {
	stop: () => void;
	/** Total entries pruned across all ticks since `schedulePreviewCachePrune` was called. */
	totalPruned: () => number;
} {
	const cache = options.cache;
	const intervalMs = options.intervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
	const intervals = options.intervals ?? productionIntervalFactory;
	let total = 0;
	const handle = intervals.set(() => {
		total += cache.prune();
	}, intervalMs);
	let stopped = false;
	return {
		stop: () => {
			if (stopped) return;
			stopped = true;
			intervals.clear(handle);
		},
		totalPruned: () => total,
	};
}
