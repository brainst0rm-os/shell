import { describe, expect, it } from "vitest";
import { makeLocator } from "../types/locator";
import { BlockKind } from "./content";
import type { PageFragment } from "./page-slice";
import { quoteForRange, resolveSelection } from "./selection-locator";

/** A page of two fragments starting at spine offset 0 ("The Anchor") and 10
 *  ("A highlight"). */
function samplePage(): PageFragment[] {
	return [
		{ kind: BlockKind.Heading, text: "The Anchor", spineOffset: 0 },
		{ kind: BlockKind.Paragraph, text: "A highlight", spineOffset: 10 },
	];
}

describe("resolveSelection", () => {
	it("maps a within-fragment selection to a stable locator range + quote", () => {
		const resolved = resolveSelection(samplePage(), 2, {
			anchor: { fragmentIndex: 0, offset: 4 },
			focus: { fragmentIndex: 0, offset: 10 },
		});
		expect(resolved).not.toBeNull();
		expect(resolved?.range.start).toEqual(makeLocator(2, 4));
		expect(resolved?.range.end).toEqual(makeLocator(2, 10));
		expect(resolved?.quote).toBe("Anchor");
	});

	it("normalizes a backward selection so start <= end", () => {
		const resolved = resolveSelection(samplePage(), 0, {
			anchor: { fragmentIndex: 1, offset: 11 },
			focus: { fragmentIndex: 0, offset: 0 },
		});
		expect(resolved?.range.start).toEqual(makeLocator(0, 0));
		expect(resolved?.range.end).toEqual(makeLocator(0, 21));
	});

	it("spans fragments, joining the covered text with a space", () => {
		const resolved = resolveSelection(samplePage(), 0, {
			anchor: { fragmentIndex: 0, offset: 4 },
			focus: { fragmentIndex: 1, offset: 11 },
		});
		expect(resolved?.quote).toBe("Anchor A highlight");
	});

	it("returns null for a collapsed (caret) selection", () => {
		expect(
			resolveSelection(samplePage(), 0, {
				anchor: { fragmentIndex: 0, offset: 3 },
				focus: { fragmentIndex: 0, offset: 3 },
			}),
		).toBeNull();
	});

	it("returns null when an endpoint is out of range", () => {
		expect(
			resolveSelection(samplePage(), 0, {
				anchor: { fragmentIndex: 9, offset: 0 },
				focus: { fragmentIndex: 0, offset: 2 },
			}),
		).toBeNull();
	});

	it("returns null for an empty page", () => {
		expect(
			resolveSelection([], 0, {
				anchor: { fragmentIndex: 0, offset: 0 },
				focus: { fragmentIndex: 0, offset: 1 },
			}),
		).toBeNull();
	});

	it("clamps an offset past the fragment text length", () => {
		const resolved = resolveSelection(samplePage(), 0, {
			anchor: { fragmentIndex: 0, offset: 0 },
			focus: { fragmentIndex: 0, offset: 999 },
		});
		expect(resolved?.range.end).toEqual(makeLocator(0, 10));
		expect(resolved?.quote).toBe("The Anchor");
	});
});

describe("quoteForRange", () => {
	it("extracts the covered substring across fragments", () => {
		const quote = quoteForRange(samplePage(), {
			start: makeLocator(0, 4),
			end: makeLocator(0, 21),
		});
		expect(quote).toBe("Anchor A highlight");
	});
});
