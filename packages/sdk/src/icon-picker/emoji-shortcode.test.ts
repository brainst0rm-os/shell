import { describe, expect, it } from "vitest";
import { ALL_EMOJIS } from "./emoji-data";
import { emojiShortcodeCandidates, resolveEmojiShortcode } from "./emoji-shortcode";

// A real slug from the dataset (avoid hardcoding one that could drift).
const sample = ALL_EMOJIS[0] as (typeof ALL_EMOJIS)[number];

describe("resolveEmojiShortcode", () => {
	it("maps a real slug to its emoji char", () => {
		expect(resolveEmojiShortcode(sample.slug)).toBe(sample.char);
	});

	it("is case-insensitive on the slug", () => {
		expect(resolveEmojiShortcode(sample.slug.toUpperCase())).toBe(sample.char);
	});

	it("returns null for an unknown slug", () => {
		expect(resolveEmojiShortcode("definitely_not_an_emoji_slug")).toBeNull();
	});

	it("resolves the canonical grinning_face when present", () => {
		const grin = ALL_EMOJIS.find((e) => e.slug === "grinning_face");
		if (grin) expect(resolveEmojiShortcode("grinning_face")).toBe(grin.char);
	});
});

describe("emojiShortcodeCandidates", () => {
	it("returns nothing for an empty query", () => {
		expect(emojiShortcodeCandidates("")).toEqual([]);
	});

	it("ranks prefix matches before substring matches, shortest slug first", () => {
		// Use a real prefix from the dataset so the test isn't dataset-fragile.
		const prefix = sample.slug.slice(0, 3);
		const out = emojiShortcodeCandidates(prefix, 50);
		expect(out.length).toBeGreaterThan(0);
		const firstPrefixHit = out.findIndex((e) => e.slug.startsWith(prefix));
		expect(firstPrefixHit).toBe(0); // a prefix hit leads
		// Within the leading prefix run, slugs are non-decreasing in length.
		const prefixRun = out.filter((e) => e.slug.startsWith(prefix));
		for (let i = 1; i < prefixRun.length; i++) {
			expect((prefixRun[i]?.slug.length ?? 0) >= (prefixRun[i - 1]?.slug.length ?? 0)).toBe(true);
		}
	});

	it("caps the result at the limit", () => {
		expect(emojiShortcodeCandidates("a", 5).length).toBeLessThanOrEqual(5);
	});
});
