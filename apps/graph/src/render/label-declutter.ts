/**
 * Screen-space label de-clutter (F-230). The label overlay can want more
 * labels than the screen can legibly hold: when hub nodes cluster near the
 * centre their captions overprint into an unreadable smear
 * ("Co…ndar" over "Content Calendar" over "Candidates"). The wanted-set
 * logic in `syncLabelOverlay` decides *which* nodes deserve a label by
 * zoom/density/degree; this decides which of those actually paint once their
 * screen rectangles are known, so overlapping captions don't stack.
 *
 * Pure + DOM-free so it unit-tests deterministically. The renderer measures
 * each candidate's screen box (centre + estimated width) and hands them here
 * in priority order; we keep a label only when its axis-aligned box clears
 * every already-kept box. Greedy-by-priority means the most important labels
 * (hovered first, then highest-degree hubs) win the space and the rest drop.
 */

/** One label's screen-space footprint + how much it deserves to survive a
 *  collision. Higher `priority` wins; ties keep input order. */
export type LabelBox = {
	id: string;
	/** Horizontal centre of the label in screen pixels. */
	centerX: number;
	/** Top edge of the label in screen pixels (labels sit below their node). */
	top: number;
	/** Estimated rendered width in screen pixels. */
	width: number;
	/** Rendered height in screen pixels (font line box). */
	height: number;
	/** Survival rank — hovered node highest, then degree-derived. */
	priority: number;
};

/** Padding (px) added around each box before the overlap test so kept labels
 *  keep a legible gutter rather than touching edge-to-edge. */
const COLLISION_PADDING = 2;

function overlaps(a: LabelBox, b: LabelBox): boolean {
	const aLeft = a.centerX - a.width / 2 - COLLISION_PADDING;
	const aRight = a.centerX + a.width / 2 + COLLISION_PADDING;
	const aTop = a.top - COLLISION_PADDING;
	const aBottom = a.top + a.height + COLLISION_PADDING;
	const bLeft = b.centerX - b.width / 2 - COLLISION_PADDING;
	const bRight = b.centerX + b.width / 2 + COLLISION_PADDING;
	const bTop = b.top - COLLISION_PADDING;
	const bBottom = b.top + b.height + COLLISION_PADDING;
	return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

/** Resolve overlaps greedily: sort by descending priority (stable on ties via
 *  the original index), then accept a label only if it clears every already-
 *  accepted box. Returns the ids to paint. O(n²) in the kept-set size — n is
 *  bounded by the wanted-set (hub cap or density cap), so this stays cheap
 *  per frame. */
export function declutterLabels(candidates: readonly LabelBox[]): Set<string> {
	const ordered = candidates
		.map((box, index) => ({ box, index }))
		.sort((a, b) => b.box.priority - a.box.priority || a.index - b.index);

	const kept: LabelBox[] = [];
	const keptIds = new Set<string>();
	for (const { box } of ordered) {
		if (kept.some((other) => overlaps(box, other))) continue;
		kept.push(box);
		keptIds.add(box.id);
	}
	return keptIds;
}

/** Per-character width estimate (px) for the 10px UI font the overlay paints
 *  with. A cheap proxy for `measureText` — exact pixel widths aren't needed;
 *  the box only has to be close enough to catch the visually-overlapping
 *  captions the user reads as a smear. */
const AVG_GLYPH_WIDTH_PX = 5.6;

/** Estimate a label's rendered width (px) from its character count. */
export function estimateLabelWidth(text: string): number {
	return text.length * AVG_GLYPH_WIDTH_PX;
}
