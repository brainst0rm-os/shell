/**
 * Inline citation hover — SH-14 + 9.7.2.
 *
 * When the user hovers a `data-citation-key` element rendered by the
 * highlight overlay, surface a tooltip with the matched plan iteration
 * / open-question's title + status + summary. Clicking the tooltip
 * opens the entity through the shared `open` intent (same path the
 * References inspector takes — single source).
 *
 * Why a custom lightweight tooltip and NOT the shared `<Popover>`
 * primitive? The shared popover is a modal/dialog (focus-trap +
 * backdrop + ESC + ARIA dialog role) — wrong shape for a passive
 * hover. The shared component family DOES need a tooltip variant
 * eventually (the second copy is here; ad-hoc per-app tooltip code
 * lives in Notes link-hover today and the Database row inspector — at
 * the third we extract per [[extract_to_sdk_at_copy_two]]). For now,
 * a self-contained DOM helper following the same chrome contract
 * (`bs-tooltip` class, glass styles via the shell's app-theme).
 */

import type { CitationEntry } from "../logic/citation-index";

export type CitationLookup = (key: string) => CitationEntry | undefined;
export type CitationOpen = (entry: CitationEntry) => void;

export interface CitationHoverLabels {
	/** Heading shown above the citation card (e.g. "Iteration", "Open question"). */
	heading: (entry: CitationEntry) => string;
	/** ARIA label for the dismiss affordance — not currently rendered on
	 *  hover, but reserved for the touch / keyboard expansion. */
	close: string;
	/** Localised label for the link/button that opens the entity. */
	openAction: string;
}

export interface AttachCitationHoverOptions {
	/** Element whose descendants carry `data-citation-key` attrs. */
	host: HTMLElement;
	lookup: CitationLookup;
	open: CitationOpen;
	labels: CitationHoverLabels;
	/** Delay before showing the tooltip on hover-in, in ms. Default 120 —
	 *  short enough to feel responsive, long enough that brushing the
	 *  cursor across an identifier doesn't flash a popup. */
	openDelayMs?: number;
	/** Delay before hiding when the cursor leaves both the citation and
	 *  the tooltip, in ms. Default 80 — long enough for the cursor to
	 *  traverse the gap between span and tooltip without re-trigger. */
	closeDelayMs?: number;
}

export interface CitationHoverHandle {
	/** Detach all listeners + remove the tooltip element. Idempotent. */
	dispose(): void;
	/** Hide the currently-shown tooltip (if any) without detaching. */
	hide(): void;
}

const TOOLTIP_CLASS = "editor__citation-tooltip";

export function attachCitationHover(opts: AttachCitationHoverOptions): CitationHoverHandle {
	const { host, lookup, open, labels } = opts;
	const openDelayMs = opts.openDelayMs ?? 120;
	const closeDelayMs = opts.closeDelayMs ?? 80;

	const tooltip = document.createElement("div");
	tooltip.className = TOOLTIP_CLASS;
	tooltip.setAttribute("role", "tooltip");
	tooltip.hidden = true;

	const heading = document.createElement("div");
	heading.className = `${TOOLTIP_CLASS}__heading`;

	const title = document.createElement("div");
	title.className = `${TOOLTIP_CLASS}__title`;

	const status = document.createElement("span");
	status.className = `${TOOLTIP_CLASS}__status`;

	const code = document.createElement("span");
	code.className = `${TOOLTIP_CLASS}__code`;

	const summary = document.createElement("div");
	summary.className = `${TOOLTIP_CLASS}__summary`;

	const action = document.createElement("button");
	action.type = "button";
	action.className = `${TOOLTIP_CLASS}__action`;
	action.textContent = labels.openAction;

	tooltip.append(heading, title, status, code, summary, action);

	let openHandle: ReturnType<typeof setTimeout> | null = null;
	let closeHandle: ReturnType<typeof setTimeout> | null = null;
	let activeEntry: CitationEntry | null = null;
	let activeAnchor: HTMLElement | null = null;
	let disposed = false;

	function clearOpenTimer(): void {
		if (openHandle !== null) {
			clearTimeout(openHandle);
			openHandle = null;
		}
	}
	function clearCloseTimer(): void {
		if (closeHandle !== null) {
			clearTimeout(closeHandle);
			closeHandle = null;
		}
	}

	function hide(): void {
		clearOpenTimer();
		clearCloseTimer();
		activeEntry = null;
		activeAnchor = null;
		tooltip.hidden = true;
		tooltip.style.removeProperty("transform");
		tooltip.style.removeProperty("top");
		tooltip.style.removeProperty("left");
	}

	function show(anchor: HTMLElement, entry: CitationEntry): void {
		activeEntry = entry;
		activeAnchor = anchor;
		heading.textContent = labels.heading(entry);
		title.textContent = entry.title;
		code.textContent = entry.code;
		if (entry.status) {
			status.textContent = entry.status;
			status.hidden = false;
			status.dataset.status = entry.status;
		} else {
			status.hidden = true;
			status.removeAttribute("data-status");
		}
		if (entry.summary) {
			summary.textContent = entry.summary;
			summary.hidden = false;
		} else {
			summary.hidden = true;
			summary.textContent = "";
		}
		tooltip.hidden = false;
		positionTooltip(anchor, tooltip);
	}

	function citationFromEvent(event: Event): { anchor: HTMLElement; entry: CitationEntry } | null {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return null;
		const anchor = target.closest<HTMLElement>("[data-citation-key]");
		if (!anchor) return null;
		const key = anchor.getAttribute("data-citation-key");
		if (!key) return null;
		const entry = lookup(key);
		if (!entry) return null;
		return { anchor, entry };
	}

	function onPointerOver(event: PointerEvent): void {
		const match = citationFromEvent(event);
		if (!match) return;
		clearCloseTimer();
		if (activeAnchor === match.anchor) return;
		clearOpenTimer();
		openHandle = setTimeout(() => {
			openHandle = null;
			show(match.anchor, match.entry);
		}, openDelayMs);
	}

	function onPointerOut(event: PointerEvent): void {
		const related = event.relatedTarget;
		// Cursor moved into the tooltip itself — keep it open.
		if (related instanceof Node && (tooltip === related || tooltip.contains(related as Node))) {
			return;
		}
		const match = citationFromEvent(event);
		if (!match) return;
		clearOpenTimer();
		closeHandle = setTimeout(() => {
			closeHandle = null;
			hide();
		}, closeDelayMs);
	}

	function onTooltipEnter(): void {
		clearCloseTimer();
	}

	function onTooltipLeave(): void {
		closeHandle = setTimeout(() => {
			closeHandle = null;
			hide();
		}, closeDelayMs);
	}

	function onActionClick(): void {
		if (!activeEntry) return;
		const entry = activeEntry;
		hide();
		open(entry);
	}

	host.addEventListener("pointerover", onPointerOver);
	host.addEventListener("pointerout", onPointerOut);
	tooltip.addEventListener("pointerenter", onTooltipEnter);
	tooltip.addEventListener("pointerleave", onTooltipLeave);
	action.addEventListener("click", onActionClick);

	document.body.appendChild(tooltip);

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			host.removeEventListener("pointerover", onPointerOver);
			host.removeEventListener("pointerout", onPointerOut);
			tooltip.removeEventListener("pointerenter", onTooltipEnter);
			tooltip.removeEventListener("pointerleave", onTooltipLeave);
			action.removeEventListener("click", onActionClick);
			hide();
			tooltip.remove();
		},
		hide,
	};
}

/** Position the tooltip just below the anchor, viewport-clamped. The
 *  helper avoids `getBoundingClientRect` -> page-scroll math by using
 *  `position: fixed` (the styles set the position type); we hand back
 *  CSS pixel coordinates directly. */
function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const tooltipRect = tooltip.getBoundingClientRect();
	const gap = 6;
	let top = rect.bottom + gap;
	let left = rect.left;
	if (top + tooltipRect.height > viewportHeight - gap) {
		// Not enough room below — flip above.
		top = Math.max(gap, rect.top - tooltipRect.height - gap);
	}
	if (left + tooltipRect.width > viewportWidth - gap) {
		left = Math.max(gap, viewportWidth - tooltipRect.width - gap);
	}
	tooltip.style.top = `${top}px`;
	tooltip.style.left = `${left}px`;
}
