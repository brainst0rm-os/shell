/**
 * openCalendarPopover — a single-date anchored picker: a `glass--strong`
 * panel hosting the shared `createMiniCalendar`, positioned at an anchor
 * point (or below an anchor element) and dismissed on outside-mousedown /
 * Escape / scroll / resize.
 *
 * The themed replacement for a native `<input type="date">` picker: every
 * date-jump surface (Journal "Go to date", future single-date pickers) pops
 * the SAME fancy calendar instead of the OS chrome. Tasks' richer two-field
 * (scheduled / due) date popover is a deliberate superset and stays bespoke
 * for now; this is the canonical single-date variant.
 */

import type { WeekStartsOn } from "../date-grid/date-grid";
import {
	type MiniCalendarLabels,
	type MiniCalendarOptions,
	createMiniCalendar,
} from "./mini-calendar";

export type CalendarPopoverAnchor = { x: number; y: number } | { element: HTMLElement };

export type CalendarPopoverOptions = {
	/** Where to anchor: a cursor/point, or an element the panel sits beneath. */
	anchor: CalendarPopoverAnchor;
	labels: MiniCalendarLabels;
	/** Accessible name for the popover dialog. */
	ariaLabel: string;
	valueMs?: number | null;
	viewMs?: number;
	todayMs?: number;
	weekStartsOn?: WeekStartsOn;
	/** Decorate each day cell (e.g. an entry-presence dot) — same hook as
	 *  `createMiniCalendar.renderCell`, so the popup matches its sidebar twin. */
	renderCell?: MiniCalendarOptions["renderCell"];
	/** Picking a day commits the value and closes the popover. */
	onSelect: (epochMs: number) => void;
};

export type CalendarPopoverHandle = { close(): void };

let openEl: HTMLElement | null = null;
let openCleanup: (() => void) | null = null;

/** Close the single open calendar popover, if any. Idempotent. */
export function closeCalendarPopover(): void {
	openCleanup?.();
	openCleanup = null;
	openEl?.remove();
	openEl = null;
}

/** Open an anchored single-date calendar picker. Replaces any open one. */
export function openCalendarPopover(opts: CalendarPopoverOptions): CalendarPopoverHandle {
	closeCalendarPopover();

	const panel = document.createElement("div");
	panel.className = "bs-cal-popover glass--strong";
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", opts.ariaLabel);

	const mini = createMiniCalendar({
		labels: opts.labels,
		...(opts.valueMs !== undefined ? { valueMs: opts.valueMs } : {}),
		...(opts.viewMs !== undefined ? { viewMs: opts.viewMs } : {}),
		...(opts.todayMs !== undefined ? { todayMs: opts.todayMs } : {}),
		...(opts.weekStartsOn !== undefined ? { weekStartsOn: opts.weekStartsOn } : {}),
		...(opts.renderCell ? { renderCell: opts.renderCell } : {}),
		onSelect: (ms) => {
			opts.onSelect(ms);
			closeCalendarPopover();
		},
	});
	panel.appendChild(mini.element);
	document.body.appendChild(panel);

	const point =
		"element" in opts.anchor
			? elementToPoint(opts.anchor.element)
			: { x: opts.anchor.x, y: opts.anchor.y };
	positionWithinViewport(panel, point);

	const onPointer = (event: MouseEvent): void => {
		if (!panel.contains(event.target as Node)) closeCalendarPopover();
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.defaultPrevented) return;
		// keyboard-exempt
		if (event.key === "Escape") {
			event.preventDefault();
			closeCalendarPopover();
		}
	};
	document.addEventListener("mousedown", onPointer, true);
	// keyboard-exempt
	document.addEventListener("keydown", onKey, true);
	window.addEventListener("resize", closeCalendarPopover);
	window.addEventListener("scroll", closeCalendarPopover, true);

	openEl = panel;
	openCleanup = () => {
		mini.destroy();
		document.removeEventListener("mousedown", onPointer, true);
		document.removeEventListener("keydown", onKey, true);
		window.removeEventListener("resize", closeCalendarPopover);
		window.removeEventListener("scroll", closeCalendarPopover, true);
	};

	return { close: closeCalendarPopover };
}

function elementToPoint(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left, y: r.bottom + 4 };
}

function positionWithinViewport(panel: HTMLElement, point: { x: number; y: number }): void {
	const rect = panel.getBoundingClientRect();
	const gutter = 8;
	let left = point.x;
	let top = point.y;
	if (left + rect.width > window.innerWidth - gutter) left = window.innerWidth - rect.width - gutter;
	if (top + rect.height > window.innerHeight - gutter)
		top = window.innerHeight - rect.height - gutter;
	if (left < gutter) left = gutter;
	if (top < gutter) top = gutter;
	panel.style.left = `${left}px`;
	panel.style.top = `${top}px`;
}
