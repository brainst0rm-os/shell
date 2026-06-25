import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import {
	buildTagBoardLanes,
	groupByTag,
	normalizeTag,
	normalizeTagList,
	reorderTags,
	retagForLaneMove,
	uniqueTags,
} from "./tag-utils";

function bookmark(overrides: Partial<Bookmark> & { id: string }): Bookmark {
	return {
		url: `https://example.com/${overrides.id}`,
		title: overrides.id,
		faviconUrl: null,
		coverImageUrl: null,
		tags: [],
		savedAt: 0,
		readAt: null,
		archivedAt: null,
		colorHint: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

describe("normalizeTag", () => {
	it("lowercases + trims", () => {
		expect(normalizeTag("  Work  ")).toBe("work");
		expect(normalizeTag("URGENT")).toBe("urgent");
	});

	it("collapses interior whitespace runs to single hyphens", () => {
		expect(normalizeTag("read   later")).toBe("read-later");
		expect(normalizeTag("machine\tlearning")).toBe("machine-learning");
	});

	it("returns null for empty or whitespace-only input", () => {
		expect(normalizeTag("")).toBeNull();
		expect(normalizeTag("   ")).toBeNull();
	});
});

describe("normalizeTagList", () => {
	it("dedups (case-insensitively) and preserves first-occurrence order", () => {
		expect(normalizeTagList(["work", "URGENT", "Work", "urgent"])).toEqual(["work", "urgent"]);
	});

	it("drops null-normalizing entries (empty / whitespace)", () => {
		expect(normalizeTagList(["valid", "", "   ", "second"])).toEqual(["valid", "second"]);
	});

	it("collapses whitespace before deduping — `Read Later` + `read-later` are one tag", () => {
		expect(normalizeTagList(["Read Later", "read-later"])).toEqual(["read-later"]);
	});
});

describe("uniqueTags", () => {
	it("counts occurrences across bookmarks; sorts by count desc then alpha", () => {
		const bookmarks: Bookmark[] = [
			bookmark({ id: "a", tags: ["work", "urgent"] }),
			bookmark({ id: "b", tags: ["work"] }),
			bookmark({ id: "c", tags: ["urgent", "archive"] }),
			bookmark({ id: "d", tags: ["work"] }),
		];
		expect(uniqueTags(bookmarks)).toEqual([
			{ tag: "work", count: 3 },
			{ tag: "urgent", count: 2 },
			{ tag: "archive", count: 1 },
		]);
	});

	it("returns an empty list for no bookmarks (or no tags)", () => {
		expect(uniqueTags([])).toEqual([]);
		expect(uniqueTags([bookmark({ id: "x" })])).toEqual([]);
	});

	it("alphabetical tie-break is stable across runs", () => {
		const bookmarks: Bookmark[] = [
			bookmark({ id: "a", tags: ["zeta"] }),
			bookmark({ id: "b", tags: ["alpha"] }),
		];
		expect(uniqueTags(bookmarks)).toEqual([
			{ tag: "alpha", count: 1 },
			{ tag: "zeta", count: 1 },
		]);
	});
});

describe("groupByTag", () => {
	it("buckets bookmarks by every tag they carry (multi-bucket membership)", () => {
		const a = bookmark({ id: "a", tags: ["work", "urgent"] });
		const b = bookmark({ id: "b", tags: ["work"] });
		const buckets = groupByTag([a, b]);
		expect(buckets.get("work")?.map((bk) => bk.id)).toEqual(["a", "b"]);
		expect(buckets.get("urgent")?.map((bk) => bk.id)).toEqual(["a"]);
	});

	it("untagged bookmarks land in the null-keyed bucket", () => {
		const x = bookmark({ id: "x" });
		const y = bookmark({ id: "y", tags: ["work"] });
		const buckets = groupByTag([x, y]);
		expect(buckets.get(null)?.map((bk) => bk.id)).toEqual(["x"]);
		expect(buckets.get("work")?.map((bk) => bk.id)).toEqual(["y"]);
	});

	it("returns an empty map for no bookmarks", () => {
		expect(groupByTag([]).size).toBe(0);
	});
});

describe("buildTagBoardLanes", () => {
	it("orders tag lanes by count desc then alpha, Untagged always last", () => {
		const lanes = buildTagBoardLanes([
			bookmark({ id: "a", tags: ["work", "ml"] }),
			bookmark({ id: "b", tags: ["work"] }),
			bookmark({ id: "c", tags: ["ml"] }),
			bookmark({ id: "d" }),
		]);
		expect(lanes.map((l) => l.tag)).toEqual(["ml", "work", null]);
		expect(lanes[0]?.bookmarks.map((bk) => bk.id)).toEqual(["a", "c"]);
		expect(lanes.at(-1)?.tag).toBeNull();
		expect(lanes.at(-1)?.bookmarks.map((bk) => bk.id)).toEqual(["d"]);
	});

	it("omits the Untagged lane when every bookmark is tagged", () => {
		const lanes = buildTagBoardLanes([bookmark({ id: "a", tags: ["x"] })]);
		expect(lanes.map((l) => l.tag)).toEqual(["x"]);
	});

	it("returns no lanes for an empty list", () => {
		expect(buildTagBoardLanes([])).toEqual([]);
	});

	it("leads with the persisted order, falls back to count/alpha for the rest", () => {
		const lanes = buildTagBoardLanes(
			[
				bookmark({ id: "a", tags: ["work"] }),
				bookmark({ id: "b", tags: ["work"] }),
				bookmark({ id: "c", tags: ["ml"] }),
				bookmark({ id: "d", tags: ["read"] }),
				bookmark({ id: "e" }),
			],
			["read", "ml"],
		);
		// `read` + `ml` lead in saved order; `work` (the highest count) falls
		// to the default tail; Untagged stays pinned last.
		expect(lanes.map((l) => l.tag)).toEqual(["read", "ml", "work", null]);
	});

	it("ignores persisted tags whose lane is now empty", () => {
		const lanes = buildTagBoardLanes([bookmark({ id: "a", tags: ["x"] })], ["gone", "x"]);
		expect(lanes.map((l) => l.tag)).toEqual(["x"]);
	});

	it("dedupes a tag listed twice in the persisted order", () => {
		const lanes = buildTagBoardLanes(
			[bookmark({ id: "a", tags: ["x"] }), bookmark({ id: "b", tags: ["y"] })],
			["x", "x", "y"],
		);
		expect(lanes.map((l) => l.tag)).toEqual(["x", "y"]);
	});

	it("a supplied display order pins columns even when counts say otherwise", () => {
		// The board feeds the last painted order as the basis, so moving a card
		// (which changes tag counts) never reshuffles the columns. Here `work`
		// has the higher count but `read` was painted first, so it stays first.
		const lanes = buildTagBoardLanes(
			[
				bookmark({ id: "a", tags: ["work"] }),
				bookmark({ id: "b", tags: ["work"] }),
				bookmark({ id: "c", tags: ["read"] }),
			],
			["read", "work"],
		);
		expect(lanes.map((l) => l.tag)).toEqual(["read", "work"]);
	});
});

describe("retagForLaneMove", () => {
	it("replaces the source tag with the destination (Move semantic)", () => {
		expect(retagForLaneMove(["work", "ml"], "work", "read")).toEqual(["ml", "read"]);
	});

	it("dropping onto Untagged just removes the source tag", () => {
		expect(retagForLaneMove(["work", "ml"], "work", null)).toEqual(["ml"]);
	});

	it("dragging from Untagged adds the destination tag", () => {
		expect(retagForLaneMove([], null, "work")).toEqual(["work"]);
	});

	it("returns the same reference when source and destination match", () => {
		const tags = ["work"];
		expect(retagForLaneMove(tags, "work", "work")).toBe(tags);
	});

	it("does not duplicate a destination tag the bookmark already has", () => {
		expect(retagForLaneMove(["work", "read"], "work", "read")).toEqual(["read"]);
	});
});

describe("reorderTags", () => {
	it("moves the dragged tag to sit before the target", () => {
		expect(reorderTags(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
	});

	it("supports moving a tag rightward", () => {
		expect(reorderTags(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
	});

	it("inserts a dragged tag absent from the order before the target", () => {
		expect(reorderTags(["a", "b"], "z", "a")).toEqual(["z", "a", "b"]);
	});

	it("appends the dragged tag when the target is absent", () => {
		expect(reorderTags(["a", "b"], "a", "z")).toEqual(["b", "a"]);
	});

	it("returns a copy unchanged when drag and target are the same", () => {
		const order = ["a", "b"];
		const next = reorderTags(order, "a", "a");
		expect(next).toEqual(["a", "b"]);
		expect(next).not.toBe(order);
	});
});
