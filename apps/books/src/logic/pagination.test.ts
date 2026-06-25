import { describe, expect, it } from "vitest";
import { makeLocator } from "../types/locator";
import { BlockKind, indexSpine } from "./content";
import {
	clampPageIndex,
	pageContains,
	pageIndexForLocator,
	paginate,
	progressAtLocator,
} from "./pagination";

const CONTENT = {
	title: "T",
	author: "A",
	spine: [
		{ title: "c1", blocks: [{ kind: BlockKind.Paragraph, text: "0123456789" }] },
		{ title: "c2", blocks: [{ kind: BlockKind.Paragraph, text: "abcdefghij" }] },
	],
};

const SPINE = indexSpine(CONTENT);

describe("paginate", () => {
	it("breaks each spine item into budget-sized pages and never spans items", () => {
		const p = paginate(SPINE, 4);
		expect(p.totalChars).toBe(20);
		// 10 chars / 4 = 3 pages per spine item, two items = 6 pages.
		expect(p.pages).toHaveLength(6);
		expect(p.pages[0]?.range).toEqual({ start: makeLocator(0, 0), end: makeLocator(0, 4) });
		expect(p.pages[2]?.range).toEqual({ start: makeLocator(0, 8), end: makeLocator(0, 10) });
		expect(p.pages[3]?.range.start).toEqual(makeLocator(1, 0));
	});

	it("an empty spine item still produces one reachable page", () => {
		const empty = indexSpine({
			title: "e",
			author: "a",
			spine: [{ title: "blank", blocks: [] }],
		});
		const p = paginate(empty, 100);
		expect(p.pages).toHaveLength(1);
		expect(p.pages[0]?.range).toEqual({ start: makeLocator(0, 0), end: makeLocator(0, 0) });
	});

	it("a tiny budget is clamped to at least one char per page", () => {
		const p = paginate(SPINE, 0);
		expect(p.pages.length).toBe(20);
	});
});

describe("pageIndexForLocator", () => {
	const p = paginate(SPINE, 4);

	it("finds the page that contains a locator", () => {
		expect(pageIndexForLocator(p, makeLocator(0, 5))).toBe(1);
		expect(pageIndexForLocator(p, makeLocator(1, 0))).toBe(3);
	});

	it("a page-break boundary resolves to the new page, not the boundary's end", () => {
		// offset 4 is the end of page 0 and the start of page 1.
		expect(pageIndexForLocator(p, makeLocator(0, 4))).toBe(1);
	});

	it("clamps out-of-range locators to first / last", () => {
		expect(pageIndexForLocator(p, makeLocator(1, 999))).toBe(5);
	});
});

describe("clampPageIndex", () => {
	const p = paginate(SPINE, 4);
	it("clamps below and above", () => {
		expect(clampPageIndex(p, -3)).toBe(0);
		expect(clampPageIndex(p, 99)).toBe(5);
		expect(clampPageIndex(p, 2)).toBe(2);
	});
});

describe("pageContains", () => {
	const p = paginate(SPINE, 4);
	it("is start-inclusive, end-exclusive within a page", () => {
		const page = p.pages[0];
		if (!page) throw new Error("no page");
		expect(pageContains(page, makeLocator(0, 0))).toBe(true);
		expect(pageContains(page, makeLocator(0, 3))).toBe(true);
		expect(pageContains(page, makeLocator(0, 4))).toBe(false);
	});
});

describe("progressAtLocator", () => {
	it("is 0 at the start and grows monotonically", () => {
		const p = paginate(SPINE, 4);
		expect(progressAtLocator(SPINE, p.totalChars, makeLocator(0, 0))).toBe(0);
		const mid = progressAtLocator(SPINE, p.totalChars, makeLocator(1, 0));
		expect(mid).toBeCloseTo(0.5, 5);
		expect(progressAtLocator(SPINE, p.totalChars, makeLocator(1, 10))).toBe(1);
	});

	it("is 0 for an empty book", () => {
		expect(progressAtLocator([], 0, makeLocator(0, 0))).toBe(0);
	});
});
