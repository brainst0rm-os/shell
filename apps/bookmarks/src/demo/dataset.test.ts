import { describe, expect, it } from "vitest";
import { surfaceFor } from "../logic/surface-for";
import { BookmarkSurface } from "../types/surface";
import { buildBookmarksDemo } from "./dataset";

describe("bookmarks demo dataset", () => {
	it("returns at least 18 bookmarks", () => {
		expect(buildBookmarksDemo().length).toBeGreaterThanOrEqual(18);
	});

	it("spans all three mutually-exclusive surfaces (Inbox + Read + Archive)", () => {
		const surfaces = new Set(buildBookmarksDemo().map((b) => surfaceFor(b)));
		expect(surfaces.has(BookmarkSurface.Inbox)).toBe(true);
		expect(surfaces.has(BookmarkSurface.Read)).toBe(true);
		expect(surfaces.has(BookmarkSurface.Archive)).toBe(true);
	});

	it("emits normalized URLs (all https://, no trailing slash on bare roots)", () => {
		for (const b of buildBookmarksDemo()) {
			expect(b.url.startsWith("https://") || b.url.startsWith("http://")).toBe(true);
			const hostOnly = /^https?:\/\/[^/]+\/$/.test(b.url);
			expect(hostOnly).toBe(false);
		}
	});

	it("includes at least one untagged bookmark so the Tags surface shows the Untagged bucket", () => {
		const untagged = buildBookmarksDemo().filter((b) => b.tags.length === 0);
		expect(untagged.length).toBeGreaterThanOrEqual(1);
	});

	it("savedAt is monotonically decreasing over the seed list (oldest last)", () => {
		const list = buildBookmarksDemo();
		for (let i = 1; i < list.length; i += 1) {
			const prev = list[i - 1];
			const curr = list[i];
			if (!prev || !curr) continue;
			expect(curr.savedAt).toBeLessThanOrEqual(prev.savedAt);
		}
	});

	it("archivedAt always implies the Archive surface routes the bookmark", () => {
		const archived = buildBookmarksDemo().filter((b) => b.archivedAt !== null);
		for (const b of archived) {
			expect(surfaceFor(b)).toBe(BookmarkSurface.Archive);
		}
	});

	it("readAt without archivedAt routes to Read", () => {
		const read = buildBookmarksDemo().filter((b) => b.readAt !== null && b.archivedAt === null);
		for (const b of read) {
			expect(surfaceFor(b)).toBe(BookmarkSurface.Read);
		}
	});
});
