/**
 * Shared anchored-popover plumbing for the property surfaces: the cell
 * editor popover (`CellPopover`) and the add-property menu both anchor
 * a fixed-position glass panel to a viewport rect, flip it above the
 * anchor when there's no room below, and dismiss on an outside
 * `mousedown` (capture phase) and Escape.
 *
 * Escape goes through the injected `EscapeMatcher` seam (Notes wires
 * its `matchesActionChord` chord registry; the default is a bare
 * `Escape` test) so the keyboard layer stays the single source of
 * truth — no raw `e.key` outside `./seams`. A mode-aware menu that
 * owns its own Escape passes `escapeMatcher: null` to opt out; the
 * position + outside-mousedown logic is the shared part.
 */

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";
import type { EscapeMatcher } from "./seams";

export type PanelAnchor = { top: number; left: number; bottom: number };

export type AnchoredPanelOptions = {
	anchor: PanelAnchor;
	width: number;
	maxHeight: number;
	gutter: number;
	ref: RefObject<HTMLElement | null>;
	onDismiss: () => void;
	/** Predicate that recognises the cancel chord, or `null` to leave
	 *  Escape to the consumer (mode-aware menus). */
	escapeMatcher: EscapeMatcher | null;
};

export type AnchoredPanelStyle = { top: number; left: number };

/** Place a panel below its anchor, flipping above when `maxHeight +
 *  gutter` doesn't fit; clamp horizontally into the viewport. */
export function computeAnchoredPanelStyle(
	anchor: PanelAnchor,
	width: number,
	maxHeight: number,
	gutter: number,
): AnchoredPanelStyle {
	const viewportH = window.innerHeight;
	const viewportW = window.innerWidth;
	const spaceBelow = viewportH - anchor.bottom;
	const top =
		spaceBelow >= maxHeight + gutter
			? anchor.bottom + gutter
			: Math.max(8, anchor.top - maxHeight - gutter);
	const left = Math.min(Math.max(8, anchor.left), viewportW - width - 8);
	return { top, left };
}

/** Drives a flipped, dismiss-on-outside, dismiss-on-Escape panel.
 *  Returns the computed `{top,left}` (initially off-screen until the
 *  layout effect runs, mirroring the pre-extraction behaviour). */
export function useAnchoredPanel({
	anchor,
	width,
	maxHeight,
	gutter,
	ref,
	onDismiss,
	escapeMatcher,
}: AnchoredPanelOptions): AnchoredPanelStyle {
	const [style, setStyle] = useState<AnchoredPanelStyle>({ top: -9999, left: -9999 });
	const { top: anchorTop, left: anchorLeft, bottom: anchorBottom } = anchor;

	// Depend on the anchor's primitive fields, not its object identity:
	// callers that recompute the anchor each render (or pass a literal)
	// must not drive a setState→render loop.
	useLayoutEffect(() => {
		setStyle(
			computeAnchoredPanelStyle(
				{ top: anchorTop, left: anchorLeft, bottom: anchorBottom },
				width,
				maxHeight,
				gutter,
			),
		);
	}, [anchorTop, anchorLeft, anchorBottom, width, maxHeight, gutter]);

	useEffect(() => {
		function onMouseDown(event: MouseEvent) {
			if (!(event.target instanceof Node)) return;
			if (ref.current?.contains(event.target)) return;
			onDismiss();
		}
		document.addEventListener("mousedown", onMouseDown, true);
		return () => document.removeEventListener("mousedown", onMouseDown, true);
	}, [ref, onDismiss]);

	useEffect(() => {
		if (escapeMatcher === null) return;
		function onKeyDown(event: KeyboardEvent) {
			if (escapeMatcher?.(event)) {
				event.preventDefault();
				onDismiss();
			}
		}
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [escapeMatcher, onDismiss]);

	return style;
}
