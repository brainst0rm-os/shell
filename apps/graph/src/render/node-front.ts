/**
 * What a node draws on its disc: its own icon, the type-glyph fallback,
 * or nothing (plain disc). Pure + tested so the zoom gating can't
 * silently regress — this exact decision has produced the recurring
 * "graph icons disappeared" report repeatedly.
 *
 * **The bug this fixes.** Real own-icons revealed at `ICON_THRESHOLD_K`
 * (k ≥ 0.5) but the type-glyph *fallback* was gated at the higher
 * `DETAIL_THRESHOLD_K` (k ≥ 1.0). Most real vault entities carry no own
 * icon (the seed writes none), so at a normal fit-zoom (k well below 1)
 * the entire icon-less majority rendered as anonymous discs while only
 * the handful with an explicit emoji showed identity. Per
 *  every object must render an
 * identifying mark; the type glyph is the fallback, not an optional
 * extra. There is no legibility reason a rasterised type glyph needs
 * more zoom than a rasterised emoji own-icon — node-size legibility is
 * handled separately by `GLYPH_MIN_RADIUS` in `scene.ts`. So both reveal
 * at the same zoom.
 */

export enum NodeFront {
	Icon = "icon",
	Glyph = "glyph",
	Disc = "disc",
}

export type NodeFrontInput = {
	/** Camera is at/above the icon-reveal zoom (k ≥ ICON_THRESHOLD_K). */
	iconZoom: boolean;
	/** A real own-icon texture is resolved + ready this frame. */
	hasIcon: boolean;
	/** A non-empty type-glyph fallback string is available (already
	 *  radius-gated upstream in `scene.ts`). */
	hasGlyph: boolean;
};

/**
 * Decide the front visual. Below the icon zoom every node is a plain
 * disc (colour carries identity when zoomed out). At/above it: the
 * object's own icon wins; otherwise the type-glyph fallback; otherwise
 * a disc. The fallback shares the icon's zoom threshold — that is the
 * whole point of this module.
 */
export function chooseNodeFront(input: NodeFrontInput): NodeFront {
	if (!input.iconZoom) return NodeFront.Disc;
	if (input.hasIcon) return NodeFront.Icon;
	if (input.hasGlyph) return NodeFront.Glyph;
	return NodeFront.Disc;
}
