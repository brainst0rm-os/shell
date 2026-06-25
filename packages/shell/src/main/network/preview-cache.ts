/**
 * Net-1c — per-(canonicalUrl, locale) preview cache with 24-hour TTL.
 *
 * Wraps `network.preview` so the broker never re-fetches the same URL
 * within a TTL window. Cache entries are keyed on the SSRF-validated
 * canonical URL (i.e. the URL after the WHATWG URL parser + the SSRF
 * floor, never the raw input) joined with the user's locale; the same
 * URL paste in two languages still mints two cache entries because
 * Open Graph + Twitter + JSON-LD can vary by `Accept-Language`.
 *
 * v1 is pure in-memory + size-capped. A persistent on-disk cache lives
 * one Net-1 slice later — the in-memory tier becomes a free L1 in
 * front of it without changing this module's surface. The keystone
 * stays: a `cacheKey(canonicalUrl, locale)`, an `LinkPreviewCache`
 * class with `get` / `set` / `clear` / `prune`, and a `MAX_ENTRIES`
 * LRU bound so a paste-storm doesn't OOM the main process.
 *
 * Pure: no Electron imports. The clock is injected so tests drive
 * TTL boundaries deterministically (no `vi.useFakeTimers` required —
 * see `preview-cache.test.ts`).
 */

import type { LinkPreview } from "./preview";

/** 24-hour TTL per doc-38 §Per-vault network setting (cache row).
 *  An entry past `fetchedAt + DEFAULT_TTL_MS` is treated as missing;
 *  the next `get` returns null and the entry is pruned in place. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard cap on cache entries (LRU eviction). 1024 is comfortable
 *  headroom for an active workday — a typical session paste-burst is
 *  in the low hundreds — without letting a misbehaving caller pin
 *  unbounded memory. Lifted to a Settings knob when the per-vault
 *  network setting slice lands (Net-1e). */
export const MAX_ENTRIES = 1024;

/** Default locale for callers that didn't supply one. Matches the
 *  shell's default `Accept-Language` (US English) so a cache miss
 *  produces the same fetch as the pre-Net-1c world. */
export const DEFAULT_LOCALE = "en";

/** Compose the cache key. Pure — exported so tests can pin the shape.
 *  `canonicalUrl` is the SSRF-validated URL (post-`checkUrl`); raw
 *  caller-supplied strings must never reach this. */
export function cacheKey(canonicalUrl: string, locale: string): string {
	return `${canonicalUrl}|${locale}`;
}

/** What the cache stores per entry. `fetchedAt` is for TTL math; the
 *  `LinkPreview` itself already carries its own `fetchedAt` but the
 *  cache owns the freshness window, not the entry. */
type CacheEntry = {
	readonly key: string;
	readonly preview: LinkPreview;
	readonly fetchedAt: number;
};

export type LinkPreviewCacheOptions = {
	/** Override the 24h TTL. Used by tests + the per-vault privacy
	 *  setting (when it later cuts the TTL or disables caching). */
	readonly ttlMs?: number;
	/** Override the 1024-entry cap. Used by tests. */
	readonly maxEntries?: number;
	/** Injected clock — `Date.now` by default. */
	readonly now?: () => number;
};

export class LinkPreviewCache {
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly now: () => number;
	/** `Map` preserves insertion order; the LRU walk reads it from
	 *  oldest → newest, evicting the head when over `maxEntries`. */
	private readonly entries = new Map<string, CacheEntry>();

	constructor(options: LinkPreviewCacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
		this.now = options.now ?? Date.now;
	}

	/** Return the cached preview for (canonicalUrl, locale) when it
	 *  exists AND is within the TTL window. Promotes the entry to the
	 *  back of the LRU list so an active URL doesn't get evicted by an
	 *  unrelated cold paste. Expired entries are pruned in place. */
	get(canonicalUrl: string, locale: string): LinkPreview | null {
		const key = cacheKey(canonicalUrl, locale);
		const entry = this.entries.get(key);
		if (!entry) return null;
		const now = this.now();
		if (now - entry.fetchedAt > this.ttlMs) {
			this.entries.delete(key);
			return null;
		}
		// LRU promote: delete + re-insert moves the entry to the tail.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.preview;
	}

	/** Insert / replace the cached preview for (canonicalUrl, locale).
	 *  `fetchedAt` is read from `this.now()` so the TTL clock starts
	 *  here, not from the upstream's `fetchedAt` (a CDN with a stale
	 *  cache shouldn't shrink our window). Evicts the LRU head when
	 *  the cache is at capacity. */
	set(canonicalUrl: string, locale: string, preview: LinkPreview): void {
		const key = cacheKey(canonicalUrl, locale);
		// Re-insert moves an existing key to the tail (LRU promote on
		// re-cache).
		if (this.entries.has(key)) {
			this.entries.delete(key);
		}
		this.entries.set(key, { key, preview, fetchedAt: this.now() });
		while (this.entries.size > this.maxEntries) {
			const head = this.entries.keys().next();
			if (head.done) break;
			this.entries.delete(head.value);
		}
	}

	/** Wipe every cached entry. Wired to the Settings → Privacy →
	 *  Network egress UI's "Clear cache" button (Net-1f). Also called
	 *  on vault switch / lock so a vault never sees another vault's
	 *  cached previews. */
	clear(): void {
		this.entries.clear();
	}

	/** Sweep expired entries. Called opportunistically (no timer in
	 *  this module — the lazy `get`-time prune handles cold reads;
	 *  this is for proactive memory reclaim when the host wants it). */
	prune(): number {
		const now = this.now();
		let removed = 0;
		for (const [key, entry] of this.entries) {
			if (now - entry.fetchedAt > this.ttlMs) {
				this.entries.delete(key);
				removed += 1;
			}
		}
		return removed;
	}

	/** Inspectable counter — tests + later Privacy panel telemetry. */
	get size(): number {
		return this.entries.size;
	}

	/** Net-1f — snapshot the cache for the Settings → Privacy → Network
	 *  panel's compact "Preview cache" row. Reads `fetchedAt` off every
	 *  entry to compute oldest/newest; O(n) over the (1024-bounded) map.
	 *  Returns `oldestMs` / `newestMs` as `null` when the cache is empty
	 *  so the renderer can render the empty state without sentinel
	 *  values. Does NOT prune — that's a separate concern (lazy `get` +
	 *  the scheduler handle eviction). */
	statsSnapshot(): { entryCount: number; oldestMs: number | null; newestMs: number | null } {
		if (this.entries.size === 0) {
			return { entryCount: 0, oldestMs: null, newestMs: null };
		}
		let oldestMs = Number.POSITIVE_INFINITY;
		let newestMs = Number.NEGATIVE_INFINITY;
		for (const entry of this.entries.values()) {
			if (entry.fetchedAt < oldestMs) oldestMs = entry.fetchedAt;
			if (entry.fetchedAt > newestMs) newestMs = entry.fetchedAt;
		}
		return { entryCount: this.entries.size, oldestMs, newestMs };
	}
}
