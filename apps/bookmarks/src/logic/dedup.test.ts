import { describe, expect, it } from "vitest";
import { ContentProvenance } from "../types/bookmark";
import type { Bookmark } from "../types/bookmark";
import { findDuplicateGroups, mergeBookmarks } from "./dedup";

function bm(over: Partial<Bookmark> & Pick<Bookmark, "id" | "url">): Bookmark {
	return {
		title: "",
		icon: null,
		faviconUrl: null,
		coverImageUrl: null,
		tags: [],
		savedAt: 1000,
		readAt: null,
		archivedAt: null,
		colorHint: null,
		createdAt: 1000,
		updatedAt: 1000,
		...over,
	};
}

describe("findDuplicateGroups", () => {
	it("returns nothing when every URL is unique", () => {
		const out = findDuplicateGroups([
			bm({ id: "a", url: "https://x.test/1" }),
			bm({ id: "b", url: "https://x.test/2" }),
		]);
		expect(out).toEqual([]);
	});

	it("groups same-URL bookmarks oldest first", () => {
		const groups = findDuplicateGroups([
			bm({ id: "new", url: "https://x.test/a", savedAt: 3000 }),
			bm({ id: "old", url: "https://x.test/a", savedAt: 1000 }),
			bm({ id: "mid", url: "https://x.test/a", savedAt: 2000 }),
			bm({ id: "solo", url: "https://x.test/b" }),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.url).toBe("https://x.test/a");
		expect(groups[0]?.bookmarks.map((b) => b.id)).toEqual(["old", "mid", "new"]);
	});
});

describe("mergeBookmarks", () => {
	const group = (bookmarks: Bookmark[]) =>
		findDuplicateGroups(bookmarks).find((g) => g.bookmarks.length >= 2) ??
		(() => {
			throw new Error("no duplicate group");
		})();

	it("keeps the oldest copy's identity + timestamps, removes the rest", () => {
		const { merged, removedIds } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", savedAt: 1000, createdAt: 900 }),
				bm({ id: "new", url: "https://x.test/a", savedAt: 2000, createdAt: 1800 }),
			]),
			9999,
		);
		expect(merged.id).toBe("old");
		expect(merged.savedAt).toBe(1000);
		expect(merged.createdAt).toBe(900);
		expect(merged.updatedAt).toBe(9999);
		expect(removedIds).toEqual(["new"]);
	});

	it("unions tags + prefers a meaningful title over an auto domain title", () => {
		const { merged } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", title: "x.test", tags: ["read"], savedAt: 1 }),
				bm({
					id: "new",
					url: "https://x.test/a",
					title: "The Real Title",
					tags: ["design", "read"],
					savedAt: 2,
				}),
			]),
			0,
		);
		expect(merged.title).toBe("The Real Title");
		expect(merged.tags).toEqual(["read", "design"]);
	});

	it("keeps read state sticky (earliest read) but stays visible if any copy is active", () => {
		const { merged } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", readAt: 500, archivedAt: 600, savedAt: 1 }),
				bm({ id: "new", url: "https://x.test/a", readAt: null, archivedAt: null, savedAt: 2 }),
			]),
			0,
		);
		expect(merged.readAt).toBe(500);
		// Not every copy was archived → merged stays active.
		expect(merged.archivedAt).toBeNull();
	});

	it("archives the merge only when every copy was archived (earliest stamp)", () => {
		const { merged } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", archivedAt: 800, savedAt: 1 }),
				bm({ id: "new", url: "https://x.test/a", archivedAt: 700, savedAt: 2 }),
			]),
			0,
		);
		expect(merged.archivedAt).toBe(700);
	});

	it("takes the freshest capture with its provenance", () => {
		const oldBlocks = [{ type: "paragraph", version: 1 }];
		const newBlocks = [{ type: "heading", version: 1 }];
		const { merged } = mergeBookmarks(
			group([
				bm({
					id: "old",
					url: "https://x.test/a",
					savedAt: 1,
					contentBlocks: oldBlocks,
					contentFetchedAt: 100,
					contentProvenance: ContentProvenance.MachineExtracted,
				}),
				bm({
					id: "new",
					url: "https://x.test/a",
					savedAt: 2,
					contentBlocks: newBlocks,
					contentFetchedAt: 200,
				}),
			]),
			0,
		);
		expect(merged.contentBlocks).toBe(newBlocks);
		expect(merged.contentFetchedAt).toBe(200);
	});

	it("joins distinct non-empty notes, primary first", () => {
		const { merged } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", notes: "first", savedAt: 1 }),
				bm({ id: "mid", url: "https://x.test/a", notes: "", savedAt: 2 }),
				bm({ id: "new", url: "https://x.test/a", notes: "second", savedAt: 3 }),
			]),
			0,
		);
		expect(merged.notes).toBe("first\n\nsecond");
	});

	it("backfills missing metadata from a later copy", () => {
		const { merged } = mergeBookmarks(
			group([
				bm({ id: "old", url: "https://x.test/a", savedAt: 1 }),
				bm({
					id: "new",
					url: "https://x.test/a",
					siteName: "Example",
					mediaType: "article",
					savedAt: 2,
				}),
			]),
			0,
		);
		expect(merged.siteName).toBe("Example");
		expect(merged.mediaType).toBe("article");
	});
});
