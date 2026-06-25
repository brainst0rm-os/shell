/**
 * MarqueePlugin — drag a rectangle in the editor's margin or empty
 * surface to select the blocks it crosses. Writes to the shared
 * `BlockSelectionStore`, so once a marquee finishes the keys are
 * available to every selection-aware surface (gutter menu, keyboard
 * chords, clipboard, etc.).
 *
 * Trigger: `mousedown` over `.notes__main` that lands EITHER outside
 * the contenteditable entirely OR on the contenteditable's own padding
 * (not on a block element). Mousedown inside a block is left to Lexical
 * for text selection.
 *
 * Per-mousemove DOM walk is acceptable for v1 doc sizes (≤ 50 blocks).
 * The `IntersectionObserver` rect cache from `30-selection.md §Marquee`
 * is the optimization for very long docs and lands when we measure
 * actual frame budget regressions.
 *
 * Auto-scroll: while a drag is active, if the cursor is within
 * `AUTO_SCROLL_ZONE_PX` of the scroll container's top / bottom edge,
 * an `rAF` loop scrolls the container at `AUTO_SCROLL_SPEED_PX` per
 * frame and re-runs the intersection so blocks that scroll into the
 * marquee join the selection.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, type NodeKey } from "lexical";
import { useEffect, useRef, useState } from "react";
import { getAllBlocks } from "../top-level-block";
import { useBlockSelectionStore } from "./block-selection-plugin";

const DRAG_THRESHOLD_PX = 8;
const AUTO_SCROLL_ZONE_PX = 40;
const AUTO_SCROLL_SPEED_PX = 16;

export type Rect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export function rectsIntersect(
	a: Pick<Rect, "left" | "top" | "right" | "bottom">,
	b: Pick<Rect, "left" | "top" | "right" | "bottom">,
): boolean {
	return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

type DragState = {
	startClientX: number;
	startClientY: number;
	lastClientX: number;
	lastClientY: number;
	active: boolean;
	pointerId: number | null;
};

export function MarqueePlugin() {
	const [editor] = useLexicalComposerContext();
	const store = useBlockSelectionStore();
	const [marquee, setMarquee] = useState<Rect | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		function shouldStart(target: Element): boolean {
			const main = target.closest(".notes__main");
			if (!main) return false;
			// Clicks landing on the gutter / drop indicator / action menu
			// belong to the gutter plugin's pointer-capture flow — marquee
			// must not race them.
			if (
				target.closest(
					".notes__gutter, .notes__drop-indicator, .notes__action-menu, .notes__slash-menu, .notes__media-inspector",
				)
			) {
				return false;
			}
			const editable = target.closest(".notes__contenteditable");
			if (!editable) return true;
			// Click on the contenteditable's own padding (target IS the
			// contenteditable element) is a valid marquee start; clicks on
			// any element inside it are text-selection territory.
			return target === editable;
		}

		function recompute() {
			const drag = dragRef.current;
			if (!drag || !drag.active) return;
			const rect: Rect = {
				left: Math.min(drag.startClientX, drag.lastClientX),
				top: Math.min(drag.startClientY, drag.lastClientY),
				right: Math.max(drag.startClientX, drag.lastClientX),
				bottom: Math.max(drag.startClientY, drag.lastClientY),
			};
			setMarquee(rect);
			const hits: NodeKey[] = [];
			editor.getEditorState().read(() => {
				for (const block of getAllBlocks($getRoot())) {
					const el = editor.getElementByKey(block.getKey());
					if (!el) continue;
					const blockRect = el.getBoundingClientRect();
					if (rectsIntersect(rect, blockRect)) hits.push(block.getKey());
				}
			});
			if (hits.length === 0) {
				store.clear();
				return;
			}
			const anchor = hits[0];
			const focus = hits[hits.length - 1];
			if (!anchor || !focus) return;
			store.setRange(hits, anchor, focus);
		}

		function autoScrollTick() {
			rafRef.current = null;
			const drag = dragRef.current;
			if (!drag || !drag.active) return;
			const main = document.querySelector<HTMLElement>(".notes__main");
			if (!main) return;
			const containerRect = main.getBoundingClientRect();
			let dy = 0;
			if (drag.lastClientY < containerRect.top + AUTO_SCROLL_ZONE_PX) {
				dy = -AUTO_SCROLL_SPEED_PX;
			} else if (drag.lastClientY > containerRect.bottom - AUTO_SCROLL_ZONE_PX) {
				dy = AUTO_SCROLL_SPEED_PX;
			}
			if (dy === 0) return;
			main.scrollBy(0, dy);
			recompute();
			rafRef.current = requestAnimationFrame(autoScrollTick);
		}

		function startAutoScrollIfNeeded() {
			if (rafRef.current !== null) return;
			rafRef.current = requestAnimationFrame(autoScrollTick);
		}

		function stopAutoScroll() {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		}

		function onMouseDown(event: MouseEvent) {
			if (event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey) return;
			if (!(event.target instanceof Element)) return;
			if (!shouldStart(event.target)) return;
			dragRef.current = {
				startClientX: event.clientX,
				startClientY: event.clientY,
				lastClientX: event.clientX,
				lastClientY: event.clientY,
				active: false,
				pointerId: null,
			};
		}

		function onMouseMove(event: MouseEvent) {
			const drag = dragRef.current;
			if (!drag) return;
			drag.lastClientX = event.clientX;
			drag.lastClientY = event.clientY;
			if (!drag.active) {
				const dx = event.clientX - drag.startClientX;
				const dy = event.clientY - drag.startClientY;
				if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
				drag.active = true;
				// Once we know it's a marquee, suppress text-selection /
				// pointerdown gestures the browser may try to start.
				event.preventDefault();
			} else {
				event.preventDefault();
			}
			recompute();
			startAutoScrollIfNeeded();
		}

		function onMouseUp() {
			const drag = dragRef.current;
			dragRef.current = null;
			stopAutoScroll();
			setMarquee(null);
			if (!drag?.active) return;
			// Selection has already been committed via `setRange` calls; nothing
			// else to do — let the user keep the captured selection.
		}

		document.addEventListener("mousedown", onMouseDown, true);
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
		return () => {
			document.removeEventListener("mousedown", onMouseDown, true);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			stopAutoScroll();
		};
	}, [editor, store]);

	if (!marquee) return null;
	return (
		<div
			className="notes__marquee"
			aria-hidden="true"
			style={{
				left: `${marquee.left}px`,
				top: `${marquee.top}px`,
				width: `${marquee.right - marquee.left}px`,
				height: `${marquee.bottom - marquee.top}px`,
			}}
		/>
	);
}
