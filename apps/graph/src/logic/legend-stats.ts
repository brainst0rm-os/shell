/**
 * Legend edge tallies (9.13 stats refinement) — counts how many of the
 * *currently-visible* edges fall in each reason category, so the colour
 * legend can read "Editor links — 12 · Property references — 4 · Shared
 * attributes — 0" instead of a bare swatch list. Surfacing the live mix
 * makes the per-category colours discoverable (you can tell at a glance
 * whether the graph you're looking at is link-heavy or attribute-heavy)
 * and lets the renderer dim categories that aren't present.
 *
 * Pure + deterministic: a `linkType` per edge in → a count per category
 * out. Mirrors the classification `link-reason` already owns rather than
 * re-deriving the category boundaries here.
 */

import { LinkCategory, linkCategory } from "./link-reason";

/** The minimal shape this module reads off a render edge — just enough to
 *  classify it. Keeps the helper testable without the full `RenderEdge`. */
export type CategorizableLink = {
	linkType: string;
};

/** Visible-edge counts keyed by category. Every category is present (zero
 *  when none of that kind is drawn) so consumers can render a stable row
 *  set without guarding for missing keys. */
export type LegendCounts = Record<LinkCategory, number>;

/** A zeroed tally with every category key present. */
export function emptyLegendCounts(): LegendCounts {
	return {
		[LinkCategory.BodyLink]: 0,
		[LinkCategory.PropertyReference]: 0,
		[LinkCategory.SharedAttribute]: 0,
	};
}

/** Tally visible edges by reason category. The input is whatever subset
 *  the canvas actually paints (`scene.renderEdges`), so the counts track
 *  history-reveal / local-scope / pattern filtering exactly as drawn. */
export function legendCounts(edges: Iterable<CategorizableLink>): LegendCounts {
	const counts = emptyLegendCounts();
	for (const edge of edges) {
		counts[linkCategory(edge.linkType)] += 1;
	}
	return counts;
}
