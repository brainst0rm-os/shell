/**
 * Pure placement math for the anchored View-settings popover.
 *
 * The popover is `position: fixed` and can be taller than the space below its
 * trigger. A fixed CSS `max-height` ignores *where* the popover is anchored, so
 * a panel opened near the top of a short window runs off the bottom edge and
 * its last section becomes unreachable (F-015). This computes a viewport-aware
 * placement: clamp the height to the room on the chosen side, and flip above
 * the anchor when there's materially more room there. The DOM layer applies the
 * result and relies on the popover's own `overflow-y: auto` for scrolling.
 */

export type AnchorRect = {
	top: number;
	bottom: number;
	right: number;
};

export type Viewport = {
	width: number;
	height: number;
};

export type PopoverPlacementOptions = {
	/** Fixed popover width. */
	width: number;
	/** Gap between the anchor and the popover, and the viewport edges. */
	margin: number;
	/** Never shrink the panel below this height — past it, scrolling is useless
	 *  and flipping/repositioning is the lesser evil. */
	minHeight: number;
};

export type PopoverPlacement = {
	left: number;
	/** Set when the panel opens below the anchor; `bottom` is then null. */
	top: number | null;
	/** Set (as a distance from the viewport bottom) when the panel flips above
	 *  the anchor; `top` is then null. */
	bottom: number | null;
	maxHeight: number;
};

/**
 * Place an anchored popover within the viewport. Right-aligns to the anchor
 * (clamped to the viewport), prefers opening below, and flips above only when
 * the space above is larger — then clamps `maxHeight` to whichever side won.
 */
export function computePopoverPlacement(
	anchor: AnchorRect,
	viewport: Viewport,
	opts: PopoverPlacementOptions,
): PopoverPlacement {
	const { width, margin, minHeight } = opts;

	let left = anchor.right - width;
	if (left < margin) left = margin;
	const maxLeft = viewport.width - width - margin;
	if (left > maxLeft) left = Math.max(margin, maxLeft);

	const spaceBelow = viewport.height - anchor.bottom - margin;
	const spaceAbove = anchor.top - margin;

	// Prefer below; flip above only when it has materially more room. A tie or
	// a slightly-smaller-below stays below so the panel doesn't jump for a few
	// pixels.
	if (spaceBelow >= spaceAbove) {
		return {
			left,
			top: anchor.bottom + margin,
			bottom: null,
			maxHeight: Math.max(minHeight, spaceBelow),
		};
	}
	return {
		left,
		top: null,
		bottom: viewport.height - anchor.top + margin,
		maxHeight: Math.max(minHeight, spaceAbove),
	};
}
