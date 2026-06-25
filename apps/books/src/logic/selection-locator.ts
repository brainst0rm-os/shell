/**
 * Map a reader DOM selection back to a stable `LocatorRange` anchor — the
 * keystone of highlight authoring (9.21.4). A selection spans one or more
 * painted page fragments; each fragment knows the absolute char offset
 * (within its spine item) where it starts (`PageFragment.spineOffset`), so
 * an (fragment, intra-fragment offset) pair resolves to a `Locator` whose
 * `charOffset` is independent of pagination / typography. The selection
 * survives re-pagination + font changes because the locator indexes the
 * content stream, not the page.
 *
 * This module is pure (no DOM): the renderer reads the live `Selection`
 * into the plain `FragmentPoint` shape and calls in here, so the
 * anchor math is testable without a browser and stays valid when 9.21.2
 * swaps the throwaway renderer for the epub.js one.
 */

import {
	type Locator,
	type LocatorRange,
	makeLocator,
	normalizeRange,
	rangeIsCollapsed,
} from "../types/locator";
import type { PageFragment } from "./page-slice";

/** A point in a selection, described relative to a painted page fragment:
 *  the fragment's index on the current page + the character offset within
 *  that fragment's `text`. The renderer derives these from the live DOM
 *  `Range` (which fragment node the anchor/focus sits in, and the offset
 *  into its text). */
export type FragmentPoint = {
	fragmentIndex: number;
	offset: number;
};

export type FragmentSelection = {
	anchor: FragmentPoint;
	focus: FragmentPoint;
};

/** The resolved highlight payload from a selection: a normalized,
 *  pagination-independent anchor range + the exact text it covered (the
 *  `quote` stored on the `Highlight/v1`, used as a self-healing fallback). */
export type ResolvedSelection = {
	range: LocatorRange;
	quote: string;
};

function pointToLocator(
	fragments: readonly PageFragment[],
	spineIndex: number,
	point: FragmentPoint,
): Locator | null {
	const fragment = fragments[point.fragmentIndex];
	if (!fragment) return null;
	const clamped = Math.max(0, Math.min(point.offset, fragment.text.length));
	return makeLocator(spineIndex, fragment.spineOffset + clamped);
}

/** Resolve a fragment-relative selection into a `LocatorRange` + the
 *  selected text. Returns `null` for a collapsed (caret) selection or an
 *  out-of-range point — there is nothing to highlight. `spineIndex` is the
 *  current page's spine item (a page never spans spine items). The quote is
 *  read straight from the page fragments between the two anchors so it
 *  matches exactly what the reader rendered. */
export function resolveSelection(
	fragments: readonly PageFragment[],
	spineIndex: number,
	selection: FragmentSelection,
): ResolvedSelection | null {
	const a = pointToLocator(fragments, spineIndex, selection.anchor);
	const b = pointToLocator(fragments, spineIndex, selection.focus);
	if (!a || !b) return null;
	const range = normalizeRange({ start: a, end: b });
	if (rangeIsCollapsed(range)) return null;
	const quote = quoteForRange(fragments, range).trim();
	if (quote.length === 0) return null;
	return { range, quote };
}

/** The exact text a (start..end) char range covers across the page's
 *  fragments — the painted substring between the two offsets, in reading
 *  order. Headings and paragraphs are joined with a single space so the
 *  quote reads naturally. */
export function quoteForRange(fragments: readonly PageFragment[], range: LocatorRange): string {
	const from = range.start.charOffset;
	const to = range.end.charOffset;
	const parts: string[] = [];
	for (const fragment of fragments) {
		const fragStart = fragment.spineOffset;
		const fragEnd = fragStart + fragment.text.length;
		if (fragEnd <= from || fragStart >= to) continue;
		const sliceStart = Math.max(fragStart, from) - fragStart;
		const sliceEnd = Math.min(fragEnd, to) - fragStart;
		parts.push(fragment.text.slice(sliceStart, sliceEnd));
	}
	return parts.join(" ");
}
