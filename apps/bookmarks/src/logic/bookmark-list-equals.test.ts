import { describe, expect, it } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { bookmarkListEquals } from "./bookmark-list-equals";

const bm = (over: Partial<Bookmark> = {}): Bookmark => ({
	id: "bm1",
	url: "https://example.com/",
	title: "Example",
	faviconUrl: null,
	coverImageUrl: null,
	tags: [],
	savedAt: 100,
	readAt: null,
	archivedAt: null,
	colorHint: null,
	createdAt: 100,
	updatedAt: 100,
	...over,
});

describe("bookmarkListEquals", () => {
	it("fresh objects with the same id→version map are equal", () => {
		const a = [bm({ id: "a", rev: 1 }), bm({ id: "b", rev: 2 })];
		const b = [bm({ id: "a", rev: 1 }), bm({ id: "b", rev: 2 })];
		expect(bookmarkListEquals(a, b)).toBe(true);
	});

	it("is order-independent (query order is not a change)", () => {
		const a = [bm({ id: "a", rev: 1 }), bm({ id: "b", rev: 2 })];
		const b = [bm({ id: "b", rev: 2 }), bm({ id: "a", rev: 1 })];
		expect(bookmarkListEquals(a, b)).toBe(true);
	});

	it("a bumped store revision is a change (foreign editor writes)", () => {
		const a = [bm({ id: "a", rev: 1 })];
		const b = [bm({ id: "a", rev: 5 })];
		expect(bookmarkListEquals(a, b)).toBe(false);
	});

	it("a bumped domain updatedAt is a change (kv/demo path without rev)", () => {
		const a = [bm({ id: "a", updatedAt: 100 })];
		const b = [bm({ id: "a", updatedAt: 200 })];
		expect(bookmarkListEquals(a, b)).toBe(false);
	});

	it("added / removed bookmarks are a change", () => {
		const a = [bm({ id: "a", rev: 1 })];
		expect(bookmarkListEquals(a, [...a, bm({ id: "b", rev: 1 })])).toBe(false);
		expect(bookmarkListEquals(a, [])).toBe(false);
	});

	it("a replaced id at the same length is a change", () => {
		const a = [bm({ id: "a", rev: 1 })];
		const b = [bm({ id: "z", rev: 1 })];
		expect(bookmarkListEquals(a, b)).toBe(false);
	});

	it("same reference short-circuits", () => {
		const a = [bm()];
		expect(bookmarkListEquals(a, a)).toBe(true);
	});
});
