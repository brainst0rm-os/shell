import { describe, expect, it } from "vitest";
import { makeLocator } from "../types/locator";
import { BlockKind, indexSpine } from "./content";
import { slicePage } from "./page-slice";
import { paginate } from "./pagination";

const CONTENT = {
	title: "T",
	author: "A",
	spine: [
		{
			title: "c1",
			blocks: [
				{ kind: BlockKind.Heading, text: "Title" },
				{ kind: BlockKind.Paragraph, text: "Hello world." },
			],
		},
	],
};

const SPINE = indexSpine(CONTENT);

describe("slicePage", () => {
	it("returns the whole content for a single full page", () => {
		const p = paginate(SPINE, 100);
		const page = p.pages[0];
		if (!page) throw new Error("no page");
		const frags = slicePage(SPINE, page.range);
		expect(frags).toHaveLength(2);
		expect(frags[0]).toMatchObject({ kind: BlockKind.Heading, text: "Title", spineOffset: 0 });
		expect(frags[1]).toMatchObject({ kind: BlockKind.Paragraph, text: "Hello world." });
	});

	it("clips a block to the page's character range", () => {
		// "Title" is 0..5, page covers 0..3 → only "Tit".
		const frags = slicePage(SPINE, { start: makeLocator(0, 0), end: makeLocator(0, 3) });
		expect(frags).toHaveLength(1);
		expect(frags[0]?.text).toBe("Tit");
	});

	it("carries the absolute spine offset for a mid-block fragment", () => {
		// page 7..10 lands inside "Hello world." (block starts at 5).
		const frags = slicePage(SPINE, { start: makeLocator(0, 7), end: makeLocator(0, 10) });
		expect(frags).toHaveLength(1);
		expect(frags[0]).toMatchObject({ text: "llo", spineOffset: 7 });
	});

	it("is empty for an unknown spine index", () => {
		expect(slicePage(SPINE, { start: makeLocator(9, 0), end: makeLocator(9, 1) })).toEqual([]);
	});
});
