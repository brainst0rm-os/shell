/**
 * Multi-day ribbon layout (9.15.20) for the Month view.
 *
 * A spanning event used to repeat as a full chip in every day cell it
 * touched. This computes, from the 42-cell month grid, a per-week lane
 * assignment so each span paints as ONE continuous bar across the columns
 * it covers — at a stable vertical lane, with rounded ends only where the
 * true span begins / ends (square where it continues into the next week).
 *
 * Pure: cells in, segments out. The renderer reserves `laneCountByWeek`
 * lane rows at the top of each cell and drops each segment at its lane.
 */

import type { MonthDayCell } from "./compile-view";
import { isMultiDayItem } from "./compile-view";
import type { ScheduledItem } from "./scheduled-item";

const COLS = 7;

export type RibbonSegment = {
	item: ScheduledItem;
	/** Week row 0..5. */
	week: number;
	/** Vertical lane within the week (stable across the span's columns). */
	lane: number;
	/** Leftmost / rightmost covered column 0..6 within the week. */
	startCol: number;
	endCol: number;
	/** The item's true start / end lands inside this week (→ rounded cap +
	 *  title at the start). False = the span continues past the week edge. */
	roundedLeft: boolean;
	roundedRight: boolean;
};

export type MonthRibbonLayout = {
	segments: readonly RibbonSegment[];
	/** Lane count per week row (length 6) — the renderer reserves this many
	 *  lane rows in every cell of that week so the bars line up. */
	laneCountByWeek: number[];
};

/** Build the ribbon layout for a 42-cell month grid. Cells must be in
 *  chronological row-major order (the compiler guarantees this). */
export function layoutMonthRibbons(cells: readonly MonthDayCell[]): MonthRibbonLayout {
	// Group each spanning item by id → the grid-cell indices it occupies.
	// The compiler pushes the SAME item reference into every intersecting
	// day's `allDayItems`, so an item's cells are exactly where it shows.
	const spanCells = new Map<string, { item: ScheduledItem; indices: number[] }>();
	cells.forEach((cell, index) => {
		for (const item of cell.allDayItems) {
			if (!isMultiDayItem(item)) continue;
			const entry = spanCells.get(item.id);
			if (entry) entry.indices.push(index);
			else spanCells.set(item.id, { item, indices: [index] });
		}
	});

	const weekCount = Math.ceil(cells.length / COLS);
	const laneCountByWeek = new Array<number>(weekCount).fill(0);
	const segments: RibbonSegment[] = [];

	// Per-week lane occupancy: lanes[week][lane] = highest endCol taken.
	const occupied: number[][][] = Array.from({ length: weekCount }, () => []);

	// Deterministic order: earlier-starting, then longer spans get lower lanes.
	const ordered = [...spanCells.values()].sort((a, b) => {
		const am = Math.min(...a.indices);
		const bm = Math.min(...b.indices);
		if (am !== bm) return am - bm;
		const al = Math.max(...a.indices) - am;
		const bl = Math.max(...b.indices) - bm;
		return bl - al;
	});

	for (const { item, indices } of ordered) {
		const minIdx = Math.min(...indices);
		const maxIdx = Math.max(...indices);
		const firstWeek = Math.floor(minIdx / COLS);
		const lastWeek = Math.floor(maxIdx / COLS);
		for (let week = firstWeek; week <= lastWeek; week++) {
			const weekStart = week * COLS;
			const startCol = Math.max(minIdx, weekStart) - weekStart;
			const endCol = Math.min(maxIdx, weekStart + COLS - 1) - weekStart;
			const lane = assignLane(occupied[week] as number[][], startCol, endCol);
			laneCountByWeek[week] = Math.max(laneCountByWeek[week] ?? 0, lane + 1);
			segments.push({
				item,
				week,
				lane,
				startCol,
				endCol,
				roundedLeft: minIdx >= weekStart,
				roundedRight: maxIdx <= weekStart + COLS - 1,
			});
		}
	}

	return { segments, laneCountByWeek };
}

/** Greedy lowest-lane assignment: the first lane whose existing spans
 *  don't overlap [startCol, endCol]. Records the new span in the lane. */
function assignLane(weekLanes: number[][], startCol: number, endCol: number): number {
	for (let lane = 0; ; lane++) {
		const taken = weekLanes[lane] ?? [];
		weekLanes[lane] = taken;
		let conflict = false;
		for (let i = 0; i < taken.length; i += 2) {
			const s = taken[i] as number;
			const e = taken[i + 1] as number;
			if (startCol <= e && endCol >= s) {
				conflict = true;
				break;
			}
		}
		if (!conflict) {
			taken.push(startCol, endCol);
			return lane;
		}
	}
}
