/**
 * Resolve a page's `LocatorRange` into the renderable block fragments it
 * covers. The reflow renderer paints these fragments; keeping the slice
 * pure means the page-content mapping is testable without a DOM.
 */

import type { LocatorRange } from "../types/locator";
import { BlockKind } from "./content";
import type { IndexedSpineItem } from "./content";

export type PageFragment = {
	kind: BlockKind;
	/** The substring of the block that falls within the page range. */
	text: string;
	/** Absolute char offset (within the spine item) where this fragment
	 *  starts — lets the renderer map a DOM selection back to a `Locator`. */
	spineOffset: number;
};

/** The fragments a page covers, in reading order. A page never spans spine
 *  items so `range.start.spineIndex === range.end.spineIndex`. */
export function slicePage(spine: IndexedSpineItem[], range: LocatorRange): PageFragment[] {
	const item = spine[range.start.spineIndex];
	if (!item) return [];
	const from = range.start.charOffset;
	const to = range.end.charOffset;
	const fragments: PageFragment[] = [];
	for (const indexed of item.blocks) {
		if (indexed.end <= from || indexed.start >= to) continue;
		const sliceStart = Math.max(indexed.start, from);
		const sliceEnd = Math.min(indexed.end, to);
		fragments.push({
			kind: indexed.block.kind,
			text: indexed.block.text.slice(sliceStart - indexed.start, sliceEnd - indexed.start),
			spineOffset: sliceStart,
		});
	}
	return fragments;
}

export { BlockKind };
