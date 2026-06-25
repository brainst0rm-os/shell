import { describe, expect, it } from "vitest";
import { WeekStartsOn } from "../types/view";
import {
	buildMonthGrid,
	buildWeekGrid,
	daysBetween,
	shiftByDays,
	shiftByMonths,
	weekdayLabels,
} from "./calendar-grid";

describe("buildWeekGrid", () => {
	it("returns 7 cells starting on Monday for Monday-first weeks", () => {
		// 2026-05-14 is a Thursday. Monday-first week starts on 2026-05-11.
		const focus = new Date(2026, 4, 14);
		const cells = buildWeekGrid(focus, focus, WeekStartsOn.Monday);
		expect(cells).toHaveLength(7);
		expect(cells.map((c) => c.dayOfMonth)).toEqual([11, 12, 13, 14, 15, 16, 17]);
	});

	it("returns 7 cells starting on Sunday for Sunday-first weeks", () => {
		const focus = new Date(2026, 4, 14); // Thursday
		const cells = buildWeekGrid(focus, focus, WeekStartsOn.Sunday);
		expect(cells.map((c) => c.dayOfMonth)).toEqual([10, 11, 12, 13, 14, 15, 16]);
	});

	it("flags isToday on cells whose dateKey matches the now anchor", () => {
		const focus = new Date(2026, 4, 14);
		const cells = buildWeekGrid(focus, focus, WeekStartsOn.Monday);
		const today = cells.find((c) => c.isToday);
		expect(today?.dayOfMonth).toBe(14);
		expect(cells.filter((c) => c.isToday)).toHaveLength(1);
	});

	it("flags weekend cells (Saturday + Sunday)", () => {
		const focus = new Date(2026, 4, 14);
		const cells = buildWeekGrid(focus, focus, WeekStartsOn.Monday);
		const weekend = cells.filter((c) => c.isWeekend);
		expect(weekend.map((c) => c.weekday).sort()).toEqual([0, 6]);
	});
});

describe("buildMonthGrid", () => {
	it("returns 6 rows × 7 cols regardless of month length", () => {
		// 2026-02 is 28 days — typically fits in 5 rows; grid forces 6.
		const focus = new Date(2026, 1, 14);
		const grid = buildMonthGrid(focus, focus, WeekStartsOn.Monday);
		expect(grid).toHaveLength(6);
		for (const row of grid) expect(row).toHaveLength(7);
	});

	it("includes leading-edge dates from the previous month", () => {
		const focus = new Date(2026, 4, 14); // May 2026; May 1 is a Friday
		const grid = buildMonthGrid(focus, focus, WeekStartsOn.Monday);
		// First cell of Monday-first May should be April 27, 2026.
		const first = grid[0]?.[0];
		expect(first?.dayOfMonth).toBe(27);
		expect(first?.inMonth).toBe(false);
	});

	it("flags inMonth correctly for the focus month", () => {
		const focus = new Date(2026, 4, 14);
		const grid = buildMonthGrid(focus, focus, WeekStartsOn.Monday);
		const allCells = grid.flat();
		const mayCells = allCells.filter((c) => c.inMonth);
		expect(mayCells).toHaveLength(31);
		expect(mayCells.map((c) => c.dayOfMonth)).toContain(14);
	});
});

describe("shiftByDays", () => {
	it("moves forward + back by N days", () => {
		const focus = new Date(2026, 4, 14);
		expect(shiftByDays(focus, 1).getDate()).toBe(15);
		expect(shiftByDays(focus, -1).getDate()).toBe(13);
		expect(shiftByDays(focus, 7).getDate()).toBe(21);
	});

	it("rolls over month boundaries cleanly", () => {
		const focus = new Date(2026, 4, 31);
		const next = shiftByDays(focus, 1);
		expect(next.getMonth()).toBe(5);
		expect(next.getDate()).toBe(1);
	});
});

describe("shiftByMonths", () => {
	it("moves forward + back by N months", () => {
		const focus = new Date(2026, 4, 14);
		expect(shiftByMonths(focus, 1).getMonth()).toBe(5);
		expect(shiftByMonths(focus, -1).getMonth()).toBe(3);
	});

	it("clamps day-of-month to the target month's length", () => {
		// Jan 31 + 1 month should be Feb 28 (2026 is not a leap year).
		const focus = new Date(2026, 0, 31);
		const next = shiftByMonths(focus, 1);
		expect(next.getMonth()).toBe(1);
		expect(next.getDate()).toBe(28);
	});
});

describe("weekdayLabels", () => {
	it("returns 7 entries starting on the configured weekStartsOn", () => {
		expect(weekdayLabels(WeekStartsOn.Monday)).toHaveLength(7);
		expect(weekdayLabels(WeekStartsOn.Sunday)).toHaveLength(7);
		expect(weekdayLabels(WeekStartsOn.Saturday)).toHaveLength(7);
	});
});

describe("daysBetween", () => {
	it("returns signed day count, tolerant of DST", () => {
		const a = new Date(2026, 4, 14).getTime();
		const b = new Date(2026, 4, 21).getTime();
		expect(daysBetween(a, b)).toBe(7);
		expect(daysBetween(b, a)).toBe(-7);
	});
});
