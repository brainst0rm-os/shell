import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { BookmarkSurface } from "../types/surface";
import {
	CollectionKind,
	collectionCount,
	collectionMembers,
	defaultCollectionName,
	matchesFilter,
	smartCollectionFromView,
} from "./collections";

function bm(over: Partial<Bookmark> & Pick<Bookmark, "id" | "url">): Bookmark {
	return {
		title: "",
		icon: null,
		faviconUrl: null,
		coverImageUrl: null,
		tags: [],
		savedAt: 1,
		readAt: null,
		archivedAt: null,
		colorHint: null,
		createdAt: 1,
		updatedAt: 1,
		...over,
	};
}

describe("matchesFilter", () => {
	const b = bm({
		id: "a",
		url: "https://example.com/design-systems",
		title: "Design Systems",
		description: "A guide",
		tags: ["design", "read-later"],
		readAt: 100,
	});

	it("matches an empty filter", () => {
		expect(matchesFilter(b, {})).toBe(true);
	});

	it("constrains by surface", () => {
		// readAt set → the bookmark is on the Read surface.
		expect(matchesFilter(b, { surface: BookmarkSurface.Read })).toBe(true);
		expect(matchesFilter(b, { surface: BookmarkSurface.Inbox })).toBe(false);
	});

	it("requires ALL listed tags (intersection)", () => {
		expect(matchesFilter(b, { tags: ["design"] })).toBe(true);
		expect(matchesFilter(b, { tags: ["design", "read-later"] })).toBe(true);
		expect(matchesFilter(b, { tags: ["design", "missing"] })).toBe(false);
	});

	it("matches a case-insensitive query over title / url / description", () => {
		expect(matchesFilter(b, { query: "DESIGN" })).toBe(true);
		expect(matchesFilter(b, { query: "guide" })).toBe(true);
		expect(matchesFilter(b, { query: "example.com" })).toBe(true);
		expect(matchesFilter(b, { query: "absent" })).toBe(false);
	});

	it("ANDs every present clause", () => {
		expect(
			matchesFilter(b, { surface: BookmarkSurface.Read, tags: ["design"], query: "guide" }),
		).toBe(true);
		expect(matchesFilter(b, { surface: BookmarkSurface.Inbox, tags: ["design"] })).toBe(false);
	});
});

describe("collectionMembers", () => {
	const bookmarks = [
		bm({ id: "a", url: "https://x.test/1", tags: ["design"] }),
		bm({ id: "b", url: "https://x.test/2", tags: ["code"], readAt: 5 }),
		bm({ id: "c", url: "https://x.test/3", tags: ["design", "code"] }),
	];

	it("evaluates a smart collection live", () => {
		const members = collectionMembers(
			{
				id: "s",
				name: "Design",
				kind: CollectionKind.Smart,
				filter: { tags: ["design"] },
				createdAt: 0,
				updatedAt: 0,
			},
			bookmarks,
		);
		expect(members.map((m) => m.id)).toEqual(["a", "c"]);
	});

	it("evaluates a manual collection by member ids, preserving input order", () => {
		const members = collectionMembers(
			{
				id: "m",
				name: "Picks",
				kind: CollectionKind.Manual,
				memberIds: ["c", "a"],
				createdAt: 0,
				updatedAt: 0,
			},
			bookmarks,
		);
		// Input order (a before c), not member-id order.
		expect(members.map((m) => m.id)).toEqual(["a", "c"]);
	});

	it("counts members", () => {
		const col = {
			id: "s",
			name: "Code",
			kind: CollectionKind.Smart,
			filter: { tags: ["code"] },
			createdAt: 0,
			updatedAt: 0,
		} as const;
		expect(collectionCount(col, bookmarks)).toBe(2);
	});
});

describe("smartCollectionFromView", () => {
	const deps = { idFactory: () => "col-1", now: () => 42 };

	it("captures a surface + tag selection as a filter", () => {
		const col = smartCollectionFromView("My reads", BookmarkSurface.Read, "design", deps);
		expect(col).toMatchObject({
			id: "col-1",
			name: "My reads",
			kind: CollectionKind.Smart,
			filter: { surface: BookmarkSurface.Read, tags: ["design"] },
			createdAt: 42,
		});
	});

	it("drops the surface constraint for the cross-cutting Tags board", () => {
		const col = smartCollectionFromView("", BookmarkSurface.Tags, "design", deps);
		expect(col.filter).toEqual({ tags: ["design"] });
		// Falls back to a derived name when none typed.
		expect(col.name).toBe("#design");
	});

	it("derives a name from the surface when no tag + no name", () => {
		const col = smartCollectionFromView("", BookmarkSurface.Inbox, null, deps);
		expect(col.name).toBe(defaultCollectionName(BookmarkSurface.Inbox, null));
		expect(col.filter).toEqual({ surface: BookmarkSurface.Inbox });
	});
});
