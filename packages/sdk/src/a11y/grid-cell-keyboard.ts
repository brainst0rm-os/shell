/**
 * `attachGridCellKeyboard` — a DOM-imperative binding for 2-D *cell grids*
 * (calendar month/week/day, the Database calendar view), built on the pure
 * `composite-keyboard` Grid reducer via `attachCompositeKeyboard`.
 *
 * The model: the grid container holds focus and `aria-activedescendant`
 * tracks the active cell (the Bin/Files virtualized-list pattern), so the
 * grid is ONE Tab stop; in-cell interactive elements (date buttons, event
 * chips) are demoted to `tabindex -1` and stay mouse-clickable while the
 * arrows move the cell cursor and Enter/Space opens the active cell. The
 * renderer materialises an index-aligned cell list — every cell carries
 * `data-composite-index` in navigation order — paired with a fixed
 * `columns` count.
 *
 * Two entry points: `attachGridCellKeyboard` stamps the matched cells in
 * DOM order (use when DOM order IS row-major, e.g. a month grid laid out as
 * week rows of 7); `attachOrderedGridCellKeyboard` takes a caller-ordered
 * array (use when DOM order differs from navigation order, e.g. a week view
 * rendered column-major — a day's 24 hour-slots, then the next day — but
 * navigated row-major so → = next day and ↓ = next hour).
 */

import { type CompositeKeyboardHandle, attachCompositeKeyboard } from "./attach-composite-keyboard";
import { Orientation } from "./orientation";

export type GridCellKeyboardOptions = {
	/** Fixed column count (7 for a month, the day count for a week grid). */
	readonly columns: number;
	/** Open the active cell (Enter / Space). */
	readonly onOpenCell: (cell: HTMLElement, index: number) => void;
	/** Initial cursor cell (e.g. the first in-month day). Clamped to range. */
	readonly initialIndex?: number;
};

/** Attach the Grid binding, stamping `gridEl`'s matching cells in DOM order. */
export function attachGridCellKeyboard(
	gridEl: HTMLElement,
	cellSelector: string,
	options: GridCellKeyboardOptions,
): CompositeKeyboardHandle {
	return attachOrderedGridCellKeyboard(
		gridEl,
		Array.from(gridEl.querySelectorAll<HTMLElement>(cellSelector)),
		options,
	);
}

/** Attach the Grid binding to a caller-ordered cell array. Indices are
 *  stamped in the array order (not DOM order); `attachCompositeKeyboard`
 *  resolves focus / activedescendant by `data-composite-index`, so a
 *  column-major DOM navigates correctly when the array is row-major. */
export function attachOrderedGridCellKeyboard(
	gridEl: HTMLElement,
	orderedCells: readonly HTMLElement[],
	options: GridCellKeyboardOptions,
): CompositeKeyboardHandle {
	orderedCells.forEach((el, i) => {
		el.dataset.compositeIndex = String(i);
		// One Tab stop for the whole grid: in-cell buttons/links stay
		// clickable but leave the Tab order to the grid container.
		for (const focusable of el.querySelectorAll<HTMLElement>("button, a, [tabindex]")) {
			focusable.tabIndex = -1;
		}
		if (el.matches("button, a, [tabindex]")) el.tabIndex = -1;
	});

	const max = Math.max(0, orderedCells.length - 1);
	let cursor = clamp(options.initialIndex ?? 0, 0, max);

	return attachCompositeKeyboard(gridEl, {
		orientation: Orientation.Grid,
		columns: () => options.columns,
		count: () => orderedCells.length,
		activeIndex: () => cursor,
		onActiveIndexChange: (index) => {
			cursor = index;
		},
		onActivate: (index) => {
			const cell = orderedCells[index];
			if (cell) options.onOpenCell(cell, index);
		},
		useAriaActiveDescendant: true,
	});
}

function clamp(value: number, lo: number, hi: number): number {
	if (value < lo) return lo;
	if (value > hi) return hi;
	return value;
}
