import { describe, expect, it } from "vitest";
import { makeLocator } from "../types/locator";
import { SAMPLE_BOOK_CONTENT } from "./sample-book";
import { tocFromContent, tocFromPdfOutline } from "./toc";

describe("tocFromContent", () => {
	it("maps every spine item to a chapter entry at its start", () => {
		const toc = tocFromContent(SAMPLE_BOOK_CONTENT);
		expect(toc).toHaveLength(SAMPLE_BOOK_CONTENT.spine.length);
		toc.forEach((entry, i) => {
			expect(entry.title).toBe(SAMPLE_BOOK_CONTENT.spine[i]?.title);
			expect(entry.locator).toEqual(makeLocator(i, 0));
			expect(entry.depth).toBe(0);
		});
	});

	it("returns [] for an empty book", () => {
		expect(tocFromContent({ title: "x", author: "y", spine: [] })).toEqual([]);
	});
});

describe("tocFromPdfOutline", () => {
	it("maps resolved outline entries onto page locators, keeping depth", () => {
		const toc = tocFromPdfOutline(
			[
				{ title: "Intro", pageIndex: 0, depth: 0 },
				{ title: "Part I", pageIndex: 3, depth: 0 },
				{ title: "Chapter 1", pageIndex: 4, depth: 1 },
			],
			12,
		);
		expect(toc).toEqual([
			{ title: "Intro", locator: makeLocator(0, 0), depth: 0 },
			{ title: "Part I", locator: makeLocator(3, 0), depth: 0 },
			{ title: "Chapter 1", locator: makeLocator(4, 0), depth: 1 },
		]);
	});

	it("drops entries pointing outside the document", () => {
		const toc = tocFromPdfOutline(
			[
				{ title: "ok", pageIndex: 1, depth: 0 },
				{ title: "past-end", pageIndex: 9, depth: 0 },
				{ title: "negative", pageIndex: -1, depth: 0 },
			],
			5,
		);
		expect(toc.map((e) => e.title)).toEqual(["ok"]);
	});
});
