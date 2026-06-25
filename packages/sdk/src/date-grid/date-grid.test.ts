/**
 * Date-grid math — contract tests. Pure helpers, no DOM, no jsdom.
 */

import { describe, expect, it } from "vitest";
import {
	WeekStartsOn,
	addDays,
	addMonths,
	buildMonthGrid,
	buildWeekGrid,
	dateKey,
	daysBetween,
	endOfDay,
	endOfMonthGrid,
	isSameDay,
	isSameMonth,
	monthGridDays,
	startOfDay,
	startOfMonth,
	startOfMonthGrid,
	startOfWeek,
	weekDays,
	weekdayLabels,
} from "./date-grid";

// Helper: epoch ms for a YYYY-MM-DD[ HH:mm] in local tz.
function at(y: number, m: number, d: number, h = 0, min = 0): number {
	return new Date(y, m - 1, d, h, min).getTime();
}

describe("primitives", () => {
	it("startOfDay zeroes the time", () => {
		const t = at(2026, 5, 20, 14, 32);
		const start = startOfDay(t);
		const d = new Date(start);
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
		expect(d.getSeconds()).toBe(0);
		expect(d.getMilliseconds()).toBe(0);
		expect(d.getDate()).toBe(20);
	});

	it("endOfDay → 23:59:59.999", () => {
		const t = endOfDay(at(2026, 5, 20));
		const d = new Date(t);
		expect(d.getHours()).toBe(23);
		expect(d.getMinutes()).toBe(59);
		expect(d.getSeconds()).toBe(59);
		expect(d.getMilliseconds()).toBe(999);
	});

	it("addDays survives a 31→32 boundary without DST drift", () => {
		// Mar 31 → Apr 1 (works across the late-Mar DST start in most regions).
		const t = addDays(at(2026, 3, 31), 1);
		expect(new Date(t).getDate()).toBe(1);
		expect(new Date(t).getMonth()).toBe(3);
	});

	it("addMonths clamps to last day of shorter target month", () => {
		// Jan 31 + 1 month → Feb 28 (2026 is not a leap year).
		const t = addMonths(at(2026, 1, 31), 1);
		expect(new Date(t).getDate()).toBe(28);
		expect(new Date(t).getMonth()).toBe(1);
	});

	it("daysBetween is signed and rounds out intra-day time", () => {
		expect(daysBetween(at(2026, 5, 1), at(2026, 5, 5, 13, 0))).toBe(4);
		expect(daysBetween(at(2026, 5, 5), at(2026, 5, 1))).toBe(-4);
	});

	it("dateKey is YYYY-MM-DD", () => {
		expect(dateKey(at(2026, 5, 7))).toBe("2026-05-07");
		expect(dateKey(at(2026, 12, 31, 23))).toBe("2026-12-31");
	});

	it("isSameDay / isSameMonth match by local-tz keys", () => {
		expect(isSameDay(at(2026, 5, 5, 0), at(2026, 5, 5, 23))).toBe(true);
		expect(isSameMonth(at(2026, 5, 1), at(2026, 5, 31))).toBe(true);
		expect(isSameMonth(at(2026, 5, 31), at(2026, 6, 1))).toBe(false);
	});
});

describe("startOfWeek", () => {
	it("lands on Monday for a Thursday input with Monday week-start", () => {
		const thu = at(2026, 5, 21);
		const mon = startOfWeek(thu, WeekStartsOn.Monday);
		expect(new Date(mon).getDay()).toBe(1);
		expect(daysBetween(mon, thu)).toBe(3);
	});

	it("lands on Sunday for a Thursday input with Sunday week-start", () => {
		const thu = at(2026, 5, 21);
		const sun = startOfWeek(thu, WeekStartsOn.Sunday);
		expect(new Date(sun).getDay()).toBe(0);
		expect(daysBetween(sun, thu)).toBe(4);
	});
});

describe("month + week grids", () => {
	it("startOfMonth zeroes day + time", () => {
		const s = startOfMonth(at(2026, 5, 14, 13));
		const d = new Date(s);
		expect(d.getDate()).toBe(1);
		expect(d.getHours()).toBe(0);
	});

	it("startOfMonthGrid lands on the configured weekday before the 1st", () => {
		// May 2026 starts on a Friday. Monday-week → Apr 27.
		const may = at(2026, 5, 14);
		const start = startOfMonthGrid(may, WeekStartsOn.Monday);
		const d = new Date(start);
		expect(d.getDay()).toBe(1);
		expect(d.getMonth()).toBe(3); // April (0-indexed)
		expect(d.getDate()).toBe(27);
	});

	it("monthGridDays returns 42 chronologically-ordered start-of-day anchors", () => {
		const days = monthGridDays(at(2026, 5, 14), WeekStartsOn.Monday);
		expect(days.length).toBe(42);
		for (let i = 1; i < days.length; i += 1) {
			const a = days[i - 1] as number;
			const b = days[i] as number;
			expect(b).toBeGreaterThan(a);
		}
	});

	it("weekDays returns 7 ordered start-of-day anchors", () => {
		const days = weekDays(at(2026, 5, 21), WeekStartsOn.Monday);
		expect(days.length).toBe(7);
		expect(new Date(days[0] as number).getDay()).toBe(1);
		expect(new Date(days[6] as number).getDay()).toBe(0);
	});

	it("endOfMonthGrid = day 41 end-of-day from the grid start", () => {
		const may = at(2026, 5, 14);
		const start = startOfMonthGrid(may, WeekStartsOn.Monday);
		const end = endOfMonthGrid(may, WeekStartsOn.Monday);
		expect(daysBetween(start, end)).toBe(41);
	});
});

describe("buildMonthGrid", () => {
	it("returns a 6×7 grid", () => {
		const grid = buildMonthGrid(at(2026, 5, 14), at(2026, 5, 14), WeekStartsOn.Monday);
		expect(grid.length).toBe(6);
		for (const row of grid) expect(row.length).toBe(7);
	});

	it("marks the focus-month cells with inMonth=true and the edges with false", () => {
		// May 2026 is Fri 1 - Sun 31. Monday-week grid spans Apr 27 - Jun 7.
		const grid = buildMonthGrid(at(2026, 5, 14), at(2026, 5, 14), WeekStartsOn.Monday);
		const firstRow = grid[0] as NonNullable<(typeof grid)[number]>;
		// Apr 27 (Mon) … Apr 30 (Thu) are out-of-month; May 1–3 are in-month.
		expect(firstRow[0]?.inMonth).toBe(false); // Apr 27
		expect(firstRow[3]?.inMonth).toBe(false); // Apr 30
		expect(firstRow[4]?.inMonth).toBe(true); // May 1
		const lastRow = grid[5] as NonNullable<(typeof grid)[number]>;
		expect(lastRow[0]?.inMonth).toBe(false); // Jun 1
	});

	it("marks today via isToday based on `nowMs`", () => {
		const today = at(2026, 5, 14);
		const grid = buildMonthGrid(today, today, WeekStartsOn.Monday);
		let count = 0;
		for (const row of grid) for (const cell of row) if (cell.isToday) count += 1;
		expect(count).toBe(1);
	});
});

describe("buildWeekGrid", () => {
	it("returns 7 cells starting on the configured weekday", () => {
		const cells = buildWeekGrid(at(2026, 5, 21), at(2026, 5, 21), WeekStartsOn.Monday);
		expect(cells.length).toBe(7);
		expect(cells[0]?.weekday).toBe(1);
		expect(cells[6]?.weekday).toBe(0);
	});

	it("populates dayOfMonth + isWeekend correctly", () => {
		const cells = buildWeekGrid(at(2026, 5, 21), at(2026, 5, 21), WeekStartsOn.Monday);
		expect(cells[5]?.isWeekend).toBe(true); // Saturday
		expect(cells[6]?.isWeekend).toBe(true); // Sunday
		expect(cells[0]?.isWeekend).toBe(false); // Monday
	});
});

describe("weekdayLabels", () => {
	it("returns 7 distinct labels in the configured order", () => {
		const mon = weekdayLabels(WeekStartsOn.Monday);
		const sun = weekdayLabels(WeekStartsOn.Sunday);
		expect(mon.length).toBe(7);
		expect(sun.length).toBe(7);
		expect(new Set(mon).size).toBe(7);
		// Same labels, different starting position.
		expect(new Set(mon)).toEqual(new Set(sun));
		expect(mon[0]).not.toBe(sun[0]);
	});
});
