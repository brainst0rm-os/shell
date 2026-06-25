import { describe, expect, it } from "vitest";
import type { LinkPreview } from "./preview";
import { DEFAULT_TTL_MS, LinkPreviewCache, MAX_ENTRIES, cacheKey } from "./preview-cache";

function makePreview(overrides: Partial<LinkPreview> = {}): LinkPreview {
	return {
		url: "https://example.com/",
		canonicalUrl: "https://example.com/",
		title: "Example",
		description: "An example page",
		image: "",
		favicon: "https://example.com/favicon.ico",
		siteName: "Example",
		mediaType: "website",
		fetchedAt: 0,
		...overrides,
	};
}

describe("cacheKey — pure key composition", () => {
	it("joins canonicalUrl + locale with a pipe", () => {
		expect(cacheKey("https://a.example/", "en")).toBe("https://a.example/|en");
	});

	it("different locales mint distinct keys", () => {
		expect(cacheKey("https://a/", "en")).not.toBe(cacheKey("https://a/", "fr"));
	});

	it("different urls mint distinct keys", () => {
		expect(cacheKey("https://a/", "en")).not.toBe(cacheKey("https://b/", "en"));
	});
});

describe("LinkPreviewCache — get/set/clear", () => {
	it("returns null on a cold key", () => {
		const c = new LinkPreviewCache();
		expect(c.get("https://x/", "en")).toBeNull();
	});

	it("stores then returns the preview", () => {
		const c = new LinkPreviewCache();
		const p = makePreview({ title: "Hello" });
		c.set("https://x/", "en", p);
		expect(c.get("https://x/", "en")).toEqual(p);
		expect(c.size).toBe(1);
	});

	it("clear wipes every entry", () => {
		const c = new LinkPreviewCache();
		c.set("https://a/", "en", makePreview());
		c.set("https://b/", "en", makePreview());
		expect(c.size).toBe(2);
		c.clear();
		expect(c.size).toBe(0);
		expect(c.get("https://a/", "en")).toBeNull();
	});

	it("same url + different locale mints two entries", () => {
		const c = new LinkPreviewCache();
		c.set("https://x/", "en", makePreview({ title: "English" }));
		c.set("https://x/", "fr", makePreview({ title: "Français" }));
		expect(c.get("https://x/", "en")?.title).toBe("English");
		expect(c.get("https://x/", "fr")?.title).toBe("Français");
		expect(c.size).toBe(2);
	});

	it("set on an existing key replaces the preview without growing size", () => {
		const c = new LinkPreviewCache();
		c.set("https://x/", "en", makePreview({ title: "Old" }));
		c.set("https://x/", "en", makePreview({ title: "New" }));
		expect(c.get("https://x/", "en")?.title).toBe("New");
		expect(c.size).toBe(1);
	});
});

describe("LinkPreviewCache — TTL", () => {
	it("returns null past the TTL window (lazy prune on get)", () => {
		let now = 1_000_000;
		const c = new LinkPreviewCache({ now: () => now });
		c.set("https://x/", "en", makePreview());
		expect(c.size).toBe(1);
		now += DEFAULT_TTL_MS + 1;
		expect(c.get("https://x/", "en")).toBeNull();
		// Expired entry is pruned in place (no stale reference).
		expect(c.size).toBe(0);
	});

	it("returns the preview just inside the TTL window", () => {
		let now = 1_000_000;
		const c = new LinkPreviewCache({ now: () => now });
		c.set("https://x/", "en", makePreview({ title: "Fresh" }));
		now += DEFAULT_TTL_MS - 1;
		expect(c.get("https://x/", "en")?.title).toBe("Fresh");
	});

	it("custom ttlMs overrides the 24h default", () => {
		let now = 0;
		const c = new LinkPreviewCache({ ttlMs: 1000, now: () => now });
		c.set("https://x/", "en", makePreview());
		now += 500;
		expect(c.get("https://x/", "en")).not.toBeNull();
		now += 600; // total elapsed 1100 > 1000
		expect(c.get("https://x/", "en")).toBeNull();
	});

	it("prune sweeps all expired entries proactively", () => {
		let now = 0;
		const c = new LinkPreviewCache({ ttlMs: 1000, now: () => now });
		c.set("https://a/", "en", makePreview());
		c.set("https://b/", "en", makePreview());
		now = 2000;
		c.set("https://c/", "en", makePreview());
		expect(c.size).toBe(3);
		const removed = c.prune();
		expect(removed).toBe(2);
		expect(c.size).toBe(1);
		expect(c.get("https://c/", "en")).not.toBeNull();
	});

	it("set re-anchors the TTL clock — re-caching extends freshness", () => {
		let now = 0;
		const c = new LinkPreviewCache({ ttlMs: 1000, now: () => now });
		c.set("https://x/", "en", makePreview({ title: "First" }));
		now = 900;
		// Re-cache same key. TTL clock resets.
		c.set("https://x/", "en", makePreview({ title: "Second" }));
		now = 1500;
		// 1500 - 900 = 600 < 1000 → still fresh.
		expect(c.get("https://x/", "en")?.title).toBe("Second");
	});
});

describe("LinkPreviewCache — LRU eviction at MAX_ENTRIES", () => {
	it("evicts the oldest entry when over capacity", () => {
		const c = new LinkPreviewCache({ maxEntries: 3 });
		c.set("https://a/", "en", makePreview({ title: "A" }));
		c.set("https://b/", "en", makePreview({ title: "B" }));
		c.set("https://c/", "en", makePreview({ title: "C" }));
		c.set("https://d/", "en", makePreview({ title: "D" }));
		expect(c.size).toBe(3);
		// `a` was the head → evicted.
		expect(c.get("https://a/", "en")).toBeNull();
		expect(c.get("https://b/", "en")?.title).toBe("B");
		expect(c.get("https://d/", "en")?.title).toBe("D");
	});

	it("get promotes the entry to the tail (LRU touch)", () => {
		const c = new LinkPreviewCache({ maxEntries: 3 });
		c.set("https://a/", "en", makePreview({ title: "A" }));
		c.set("https://b/", "en", makePreview({ title: "B" }));
		c.set("https://c/", "en", makePreview({ title: "C" }));
		// Touch `a` so it's no longer the LRU head.
		expect(c.get("https://a/", "en")?.title).toBe("A");
		c.set("https://d/", "en", makePreview({ title: "D" }));
		// Now `b` is the LRU head → evicted.
		expect(c.get("https://b/", "en")).toBeNull();
		expect(c.get("https://a/", "en")?.title).toBe("A");
	});

	it("re-caching an existing key doesn't trip the LRU cap (no growth)", () => {
		const c = new LinkPreviewCache({ maxEntries: 2 });
		c.set("https://a/", "en", makePreview({ title: "A" }));
		c.set("https://b/", "en", makePreview({ title: "B" }));
		// Replace, not insert → size stays 2.
		c.set("https://a/", "en", makePreview({ title: "A2" }));
		expect(c.size).toBe(2);
		expect(c.get("https://a/", "en")?.title).toBe("A2");
		expect(c.get("https://b/", "en")?.title).toBe("B");
	});

	it("MAX_ENTRIES default is 1024 (cap is real)", () => {
		// Sanity: walk the default cap from 0 → 1024 → 1025 → expect 1024.
		const c = new LinkPreviewCache();
		for (let i = 0; i < MAX_ENTRIES + 5; i++) {
			c.set(`https://example.com/${i}`, "en", makePreview({ title: String(i) }));
		}
		expect(c.size).toBe(MAX_ENTRIES);
		// The first 5 were evicted.
		expect(c.get("https://example.com/0", "en")).toBeNull();
		expect(c.get("https://example.com/4", "en")).toBeNull();
		// The last one is there.
		expect(c.get(`https://example.com/${MAX_ENTRIES + 4}`, "en")?.title).toBe(
			String(MAX_ENTRIES + 4),
		);
	});
});

describe("LinkPreviewCache.statsSnapshot — Net-1f Settings → Privacy panel feed", () => {
	it("returns zeroed/null stats for an empty cache", () => {
		const c = new LinkPreviewCache();
		expect(c.statsSnapshot()).toEqual({ entryCount: 0, oldestMs: null, newestMs: null });
	});

	it("reports entryCount + min/max fetchedAt across entries", () => {
		let clock = 1_000;
		const c = new LinkPreviewCache({ now: () => clock });
		c.set("https://a/", "en", makePreview({ title: "A" }));
		clock = 2_000;
		c.set("https://b/", "en", makePreview({ title: "B" }));
		clock = 3_000;
		c.set("https://c/", "en", makePreview({ title: "C" }));
		const stats = c.statsSnapshot();
		expect(stats.entryCount).toBe(3);
		expect(stats.oldestMs).toBe(1_000);
		expect(stats.newestMs).toBe(3_000);
	});

	it("LRU re-cache updates the entry's fetchedAt (newestMs reflects re-cache)", () => {
		let clock = 1_000;
		const c = new LinkPreviewCache({ now: () => clock });
		c.set("https://a/", "en", makePreview());
		clock = 5_000;
		c.set("https://a/", "en", makePreview()); // re-cache
		const stats = c.statsSnapshot();
		expect(stats.entryCount).toBe(1);
		expect(stats.oldestMs).toBe(5_000);
		expect(stats.newestMs).toBe(5_000);
	});

	it("clear resets stats to the empty snapshot", () => {
		const c = new LinkPreviewCache();
		c.set("https://a/", "en", makePreview());
		c.clear();
		expect(c.statsSnapshot()).toEqual({ entryCount: 0, oldestMs: null, newestMs: null });
	});
});
