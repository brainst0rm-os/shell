import { describe, expect, it } from "vitest";
import { dateMentionCandidates, resolveDateMention } from "./date-mention";

// A fixed local instant — every assertion is relative (today vs tomorrow) or
// compared to the same local computation, so it's timezone-independent.
const NOW = new Date(2025, 4, 15, 12, 0, 0).getTime(); // 2025-05-15 local noon

describe("resolveDateMention", () => {
	it("resolves today to the local calendar date of `now`", () => {
		expect(resolveDateMention("today", NOW)).toEqual({ iso: "2025-05-15", label: "Today" });
	});

	it("resolves tomorrow / yesterday as ±1 calendar day", () => {
		expect(resolveDateMention("tomorrow", NOW)?.iso).toBe("2025-05-16");
		expect(resolveDateMention("yesterday", NOW)?.iso).toBe("2025-05-14");
	});

	it("is case-insensitive and trims the query", () => {
		expect(resolveDateMention("  ToMoRRoW ", NOW)?.iso).toBe("2025-05-16");
	});

	it("crosses a month boundary", () => {
		const eom = new Date(2025, 4, 31, 9, 0, 0).getTime(); // 2025-05-31
		expect(resolveDateMention("tomorrow", eom)?.iso).toBe("2025-06-01");
	});

	it("passes a valid ISO day through verbatim", () => {
		expect(resolveDateMention("2025-12-25", NOW)).toEqual({
			iso: "2025-12-25",
			label: "2025-12-25",
		});
	});

	it("rejects non-dates and impossible ISO days", () => {
		expect(resolveDateMention("", NOW)).toBeNull();
		expect(resolveDateMention("someday", NOW)).toBeNull();
		expect(resolveDateMention("2025-13-40", NOW)).toBeNull();
		expect(resolveDateMention("2025-02-30", NOW)).toBeNull();
		expect(resolveDateMention("2025-5-1", NOW)).toBeNull(); // not zero-padded
	});
});

describe("dateMentionCandidates", () => {
	it("lists all keywords for an empty query (typeahead just opened)", () => {
		expect(dateMentionCandidates("", NOW).map((d) => d.label)).toEqual([
			"Today",
			"Tomorrow",
			"Yesterday",
		]);
	});

	it("prefix-filters the keywords", () => {
		expect(dateMentionCandidates("to", NOW).map((d) => d.label)).toEqual(["Today", "Tomorrow"]);
		expect(dateMentionCandidates("yes", NOW).map((d) => d.label)).toEqual(["Yesterday"]);
	});

	it("offers a valid ISO query as its own candidate", () => {
		const c = dateMentionCandidates("2025-12-25", NOW);
		expect(c.at(-1)).toEqual({ iso: "2025-12-25", label: "2025-12-25" });
	});

	it("returns nothing for a non-matching query", () => {
		expect(dateMentionCandidates("zzz", NOW)).toEqual([]);
	});
});
