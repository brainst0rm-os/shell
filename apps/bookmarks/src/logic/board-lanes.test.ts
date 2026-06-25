import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { BookmarkGrouping } from "../types/surface";
import { type BoardLaneLabels, SavedPeriod, buildBoardLanes, savedPeriodOf } from "./board-lanes";
import { domainFromUrl } from "./url-parse";

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

const LABELS: BoardLaneLabels = {
	savedPeriod: (period) => `period:${period}`,
	unknownDomain: () => "Unknown domain",
	unknownSite: () => "Unknown site",
	unknownAuthor: () => "Unknown author",
};

function opts(now = 0, order: string[] = []) {
	return { order, host: domainFromUrl, now, labels: LABELS };
}

const NOW = new Date("2026-06-22T12:00:00Z").getTime();
const DAY = 86_400_000;

describe("savedPeriodOf", () => {
	it("buckets relative to local midnight", () => {
		expect(savedPeriodOf(NOW, NOW)).toBe(SavedPeriod.Today);
		expect(savedPeriodOf(NOW - 3 * DAY, NOW)).toBe(SavedPeriod.Week);
		expect(savedPeriodOf(NOW - 20 * DAY, NOW)).toBe(SavedPeriod.Month);
		expect(savedPeriodOf(NOW - 200 * DAY, NOW)).toBe(SavedPeriod.Older);
	});
});

describe("buildBoardLanes — Tags axis (unchanged behaviour)", () => {
	it("mirrors the tag board: persisted order first, Untagged last", () => {
		const bs = [
			bookmark({ id: "a", tags: ["work"] }),
			bookmark({ id: "b", tags: ["design"] }),
			bookmark({ id: "c", tags: [] }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.Tags, opts(NOW, ["design", "work"]));
		expect(lanes.map((l) => l.key)).toEqual(["design", "work", null]);
		// Tag lanes carry no literal label — the renderer derives the heading.
		expect(lanes.every((l) => l.label === null)).toBe(true);
		expect(lanes[2]?.bookmarks.map((b) => b.id)).toEqual(["c"]);
	});
});

describe("buildBoardLanes — Domain axis", () => {
	it("buckets by host, count desc then alpha, unknown trailing", () => {
		const bs = [
			bookmark({ id: "a", url: "https://news.ycombinator.com/x" }),
			bookmark({ id: "b", url: "https://news.ycombinator.com/y" }),
			bookmark({ id: "c", url: "https://example.org/z" }),
			bookmark({ id: "d", url: "not a url" }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.Domain, opts(NOW));
		expect(lanes.map((l) => l.key)).toEqual(["news.ycombinator.com", "example.org", null]);
		expect(lanes[0]?.label).toBe("news.ycombinator.com");
		expect(lanes[2]?.label).toBe("Unknown domain");
		expect(lanes[2]?.bookmarks.map((b) => b.id)).toEqual(["d"]);
	});
});

describe("buildBoardLanes — Site axis", () => {
	it("uses siteName, falling back to host, empty host trailing", () => {
		const bs = [
			bookmark({ id: "a", siteName: "Hacker News", url: "https://news.ycombinator.com/x" }),
			bookmark({ id: "b", url: "https://example.org/z" }),
			bookmark({ id: "c", siteName: "   ", url: "bad url" }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.Site, opts(NOW));
		const byKey = new Map(lanes.map((l) => [l.key, l]));
		expect(byKey.has("Hacker News")).toBe(true);
		expect(byKey.has("example.org")).toBe(true);
		// Blank siteName + unparseable URL → trailing Unknown-site bucket.
		expect(byKey.get(null)?.label).toBe("Unknown site");
		expect(byKey.get(null)?.bookmarks.map((b) => b.id)).toEqual(["c"]);
	});
});

describe("buildBoardLanes — Author axis", () => {
	it("buckets by author, empty trailing", () => {
		const bs = [
			bookmark({ id: "a", author: "Jane Doe" }),
			bookmark({ id: "b", author: "Jane Doe" }),
			bookmark({ id: "c", author: "  " }),
			bookmark({ id: "d" }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.Author, opts(NOW));
		expect(lanes[0]?.key).toBe("Jane Doe");
		expect(lanes[0]?.bookmarks.map((b) => b.id)).toEqual(["a", "b"]);
		const trailing = lanes.find((l) => l.key === null);
		expect(trailing?.label).toBe("Unknown author");
		expect(trailing?.bookmarks.map((b) => b.id).sort()).toEqual(["c", "d"]);
	});
});

describe("buildBoardLanes — SavedDate axis", () => {
	it("sections into periods, most recent first, only non-empty", () => {
		const bs = [
			bookmark({ id: "today", savedAt: NOW }),
			bookmark({ id: "week", savedAt: NOW - 3 * DAY }),
			bookmark({ id: "old", savedAt: NOW - 200 * DAY }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.SavedDate, opts(NOW));
		expect(lanes.map((l) => l.key)).toEqual([SavedPeriod.Today, SavedPeriod.Week, SavedPeriod.Older]);
		expect(lanes[0]?.label).toBe(`period:${SavedPeriod.Today}`);
	});

	it("orders bookmarks within a period most-recent first", () => {
		const bs = [
			bookmark({ id: "older", savedAt: NOW - 5 * DAY }),
			bookmark({ id: "newer", savedAt: NOW - 1 * DAY }),
		];
		const lanes = buildBoardLanes(bs, BookmarkGrouping.SavedDate, opts(NOW));
		expect(lanes[0]?.bookmarks.map((b) => b.id)).toEqual(["newer", "older"]);
	});
});
