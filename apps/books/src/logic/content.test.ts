import { describe, expect, it } from "vitest";
import { BlockKind, indexSpine, indexSpineItem, totalLength } from "./content";
import { SAMPLE_BOOK_CONTENT } from "./sample-book";

const ITEM = {
	title: "T",
	blocks: [
		{ kind: BlockKind.Heading, text: "Head" },
		{ kind: BlockKind.Paragraph, text: "Body." },
	],
};

describe("indexSpineItem", () => {
	it("assigns contiguous head-to-tail char offsets", () => {
		const indexed = indexSpineItem(ITEM);
		expect(indexed.blocks[0]).toMatchObject({ start: 0, end: 4 });
		expect(indexed.blocks[1]).toMatchObject({ start: 4, end: 9 });
		expect(indexed.length).toBe(9);
	});

	it("an empty spine item has zero length", () => {
		expect(indexSpineItem({ title: "x", blocks: [] }).length).toBe(0);
	});
});

describe("indexSpine + totalLength over the sample", () => {
	it("totals every block's text length", () => {
		const indexed = indexSpine(SAMPLE_BOOK_CONTENT);
		const expected = SAMPLE_BOOK_CONTENT.spine
			.flatMap((s) => s.blocks)
			.reduce((n, b) => n + b.text.length, 0);
		expect(totalLength(indexed)).toBe(expected);
		expect(indexed).toHaveLength(SAMPLE_BOOK_CONTENT.spine.length);
	});
});
