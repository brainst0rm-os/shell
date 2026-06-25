import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { BookmarkSurface } from "../types/surface";
import { filterForSurface, surfaceFor } from "./surface-for";

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

describe("surfaceFor — primary precedence", () => {
	it("Archive when archivedAt is set, regardless of readAt", () => {
		expect(surfaceFor(bookmark({ id: "a", archivedAt: 1000 }))).toBe(BookmarkSurface.Archive);
		expect(surfaceFor(bookmark({ id: "b", archivedAt: 1000, readAt: 500 }))).toBe(
			BookmarkSurface.Archive,
		);
	});

	it("Read when readAt is set + archivedAt is null", () => {
		expect(surfaceFor(bookmark({ id: "r", readAt: 100 }))).toBe(BookmarkSurface.Read);
	});

	it("Inbox is the default for active + unread", () => {
		expect(surfaceFor(bookmark({ id: "i" }))).toBe(BookmarkSurface.Inbox);
	});

	it("epoch-0 timestamps still count as set (don't conflate with null)", () => {
		expect(surfaceFor(bookmark({ id: "z", readAt: 0 }))).toBe(BookmarkSurface.Read);
		expect(surfaceFor(bookmark({ id: "z2", archivedAt: 0 }))).toBe(BookmarkSurface.Archive);
	});
});

describe("filterForSurface", () => {
	const bookmarks: Bookmark[] = [
		bookmark({ id: "i1" }),
		bookmark({ id: "i2" }),
		bookmark({ id: "r1", readAt: 100 }),
		bookmark({ id: "a1", archivedAt: 200 }),
		bookmark({ id: "a2", archivedAt: 300, readAt: 100 }),
	];

	it("Inbox filter returns only Inbox-routed bookmarks", () => {
		expect(filterForSurface(bookmarks, BookmarkSurface.Inbox).map((b) => b.id)).toEqual(["i1", "i2"]);
	});

	it("Read filter returns only Read-routed bookmarks", () => {
		expect(filterForSurface(bookmarks, BookmarkSurface.Read).map((b) => b.id)).toEqual(["r1"]);
	});

	it("Archive filter returns only Archive-routed bookmarks (read + archived counts)", () => {
		expect(filterForSurface(bookmarks, BookmarkSurface.Archive).map((b) => b.id)).toEqual([
			"a1",
			"a2",
		]);
	});

	it("Tags filter is cross-cutting — every bookmark is returned (caller groups via groupByTag)", () => {
		expect(filterForSurface(bookmarks, BookmarkSurface.Tags).length).toBe(bookmarks.length);
	});
});
