import { describe, expect, it } from "vitest";
import { LinkPreviewCache } from "./preview-cache";
import {
	DEFAULT_PRUNE_INTERVAL_MS,
	type IntervalFactory,
	schedulePreviewCachePrune,
} from "./preview-cache-scheduler";

/** A manual ticker that records scheduled handlers + lets the test
 *  fire them on demand. Mirrors the `IntervalFactory` shape so the
 *  scheduler doesn't know it's running under a stub. */
function makeManualTicker(): IntervalFactory & {
	tick: () => void;
	intervalMs: () => number | null;
	cleared: () => boolean;
} {
	let handler: (() => void) | null = null;
	let ms: number | null = null;
	let cleared = false;
	return {
		set: (h, m) => {
			handler = h;
			ms = m;
			return 1 as unknown as ReturnType<typeof setInterval>;
		},
		clear: () => {
			cleared = true;
			handler = null;
		},
		tick: () => {
			if (handler) handler();
		},
		intervalMs: () => ms,
		cleared: () => cleared,
	};
}

function makePreview(title: string) {
	return {
		url: `https://${title}.example/`,
		canonicalUrl: `https://${title}.example/`,
		title,
		description: "",
		image: "",
		favicon: "",
		siteName: "",
		mediaType: "website",
		fetchedAt: 0,
	};
}

describe("schedulePreviewCachePrune", () => {
	it("schedules with the default 30-minute interval", () => {
		const cache = new LinkPreviewCache();
		const ticker = makeManualTicker();
		const { stop } = schedulePreviewCachePrune({ cache, intervals: ticker });
		expect(ticker.intervalMs()).toBe(DEFAULT_PRUNE_INTERVAL_MS);
		stop();
	});

	it("custom intervalMs overrides the default", () => {
		const cache = new LinkPreviewCache();
		const ticker = makeManualTicker();
		const { stop } = schedulePreviewCachePrune({
			cache,
			intervalMs: 1234,
			intervals: ticker,
		});
		expect(ticker.intervalMs()).toBe(1234);
		stop();
	});

	it("each tick calls `cache.prune()` and accumulates `totalPruned`", () => {
		let now = 0;
		const cache = new LinkPreviewCache({ ttlMs: 1000, now: () => now });
		const ticker = makeManualTicker();
		const { stop, totalPruned } = schedulePreviewCachePrune({
			cache,
			intervals: ticker,
		});
		cache.set("https://a/", "en", makePreview("a"));
		cache.set("https://b/", "en", makePreview("b"));
		// Move past the TTL so both are expired.
		now = 2000;
		ticker.tick();
		expect(totalPruned()).toBe(2);
		// Cache is now empty; another tick prunes nothing.
		ticker.tick();
		expect(totalPruned()).toBe(2);
		stop();
	});

	it("stop() cancels the interval — no further prunes after", () => {
		const cache = new LinkPreviewCache();
		const ticker = makeManualTicker();
		const { stop } = schedulePreviewCachePrune({ cache, intervals: ticker });
		expect(ticker.cleared()).toBe(false);
		stop();
		expect(ticker.cleared()).toBe(true);
	});

	it("stop() is idempotent — double-call doesn't double-clear", () => {
		const cache = new LinkPreviewCache();
		let clearCount = 0;
		const ticker: IntervalFactory = {
			set: () => 1 as unknown as ReturnType<typeof setInterval>,
			clear: () => {
				clearCount += 1;
			},
		};
		const { stop } = schedulePreviewCachePrune({ cache, intervals: ticker });
		stop();
		stop();
		stop();
		expect(clearCount).toBe(1);
	});

	it("totalPruned starts at 0 and only counts actual evictions", () => {
		let now = 0;
		const cache = new LinkPreviewCache({ ttlMs: 10_000, now: () => now });
		const ticker = makeManualTicker();
		const { stop, totalPruned } = schedulePreviewCachePrune({
			cache,
			intervals: ticker,
		});
		expect(totalPruned()).toBe(0);
		// Add an entry inside the TTL window — prune evicts nothing.
		cache.set("https://x/", "en", makePreview("x"));
		ticker.tick();
		expect(totalPruned()).toBe(0);
		// Roll past TTL and tick — single eviction.
		now = 20_000;
		ticker.tick();
		expect(totalPruned()).toBe(1);
		stop();
	});
});
