import { describe, expect, it } from "vitest";
import { WeekStartsOn } from "../types/calendar-view";
import {
	addDays,
	addMonths,
	dateKey,
	daysBetween,
	endOfDay,
	endOfMonth,
	endOfMonthGrid,
	endOfWeek,
	isSameDay,
	isSameMonth,
	monthGridDays,
	startOfDay,
	startOfMonth,
	startOfMonthGrid,
	startOfWeek,
	weekDays,
} from "./date-range";

function epoch(y: number, m: number, d: number, h = 0, min = 0): number {
	return new Date(y, m, d, h, min, 0, 0).getTime();
}

describe("date-range — day anchors", () => {
	it("startOfDay zeroes time components without changing the date", () => {
		const e = startOfDay(epoch(2026, 4, 14, 23, 45));
		const d = new Date(e);
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
		expect(d.getSeconds()).toBe(0);
		expect(d.getMilliseconds()).toBe(0);
		expect(d.getDate()).toBe(14);
	});

	it("endOfDay sits at 23:59:59.999 same date", () => {
		const e = endOfDay(epoch(2026, 4, 14, 1, 0));
		const d = new Date(e);
		expect(d.getDate()).toBe(14);
		expect(d.getHours()).toBe(23);
		expect(d.getMilliseconds()).toBe(999);
	});

	it("addDays handles month + year boundaries", () => {
		const lastDayMay = epoch(2026, 4, 31);
		const firstDayJune = epoch(2026, 5, 1);
		expect(addDays(lastDayMay, 1)).toBe(firstDayJune);

		const newYearsEve = epoch(2025, 11, 31);
		const newYearsDay = epoch(2026, 0, 1);
		expect(addDays(newYearsEve, 1)).toBe(newYearsDay);
	});

	it("daysBetween ignores time, returns signed delta", () => {
		expect(daysBetween(epoch(2026, 4, 14, 23), epoch(2026, 4, 15, 0))).toBe(1);
		expect(daysBetween(epoch(2026, 4, 14, 0), epoch(2026, 4, 14, 23))).toBe(0);
		expect(daysBetween(epoch(2026, 4, 14, 0), epoch(2026, 4, 10, 23))).toBe(-4);
	});
});

describe("date-range — month anchors", () => {
	it("startOfMonth lands on the 1st at 00:00", () => {
		const e = startOfMonth(epoch(2026, 4, 14, 13));
		const d = new Date(e);
		expect(d.getDate()).toBe(1);
		expect(d.getHours()).toBe(0);
		expect(d.getMonth()).toBe(4);
	});

	it("endOfMonth lands on the last day of the month at 23:59:59.999", () => {
		const e = endOfMonth(epoch(2026, 4, 14));
		const d = new Date(e);
		expect(d.getDate()).toBe(31);
		expect(d.getMonth()).toBe(4);
		expect(d.getHours()).toBe(23);
	});

	it("addMonths clamps day on shorter target months", () => {
		const jan31 = epoch(2026, 0, 31);
		const target = addMonths(jan31, 1);
		const d = new Date(target);
		expect(d.getMonth()).toBe(1); // February
		expect(d.getDate()).toBe(28); // 2026 not a leap year
	});

	it("addMonths handles negative direction across year boundary", () => {
		const may = epoch(2026, 4, 14);
		const prevYearJune = addMonths(may, -11);
		const d = new Date(prevYearJune);
		expect(d.getMonth()).toBe(5);
		expect(d.getFullYear()).toBe(2025);
	});
});

describe("date-range — week anchors", () => {
	it("startOfWeek with Monday lands on Monday for a Thursday input", () => {
		const thu = epoch(2026, 4, 14);
		const monStart = startOfWeek(thu, WeekStartsOn.Monday);
		const d = new Date(monStart);
		expect(d.getDay()).toBe(1); // Monday
		expect(d.getDate()).toBe(11);
		expect(d.getHours()).toBe(0);
	});

	it("startOfWeek with Sunday lands on Sunday", () => {
		const thu = epoch(2026, 4, 14);
		const sunStart = startOfWeek(thu, WeekStartsOn.Sunday);
		const d = new Date(sunStart);
		expect(d.getDay()).toBe(0);
		expect(d.getDate()).toBe(10);
	});

	it("endOfWeek is six days after start at 23:59:59.999", () => {
		const thu = epoch(2026, 4, 14);
		const end = endOfWeek(thu, WeekStartsOn.Monday);
		const d = new Date(end);
		expect(d.getDate()).toBe(17);
		expect(d.getDay()).toBe(0); // Sunday
		expect(d.getHours()).toBe(23);
	});

	it("weekDays returns 7 day anchors ordered chronologically", () => {
		const days = weekDays(epoch(2026, 4, 14), WeekStartsOn.Monday);
		expect(days).toHaveLength(7);
		for (let i = 1; i < days.length; i++) {
			const a = days[i - 1] as number;
			const b = days[i] as number;
			expect(b > a).toBe(true);
		}
		expect(new Date(days[0] as number).getDay()).toBe(1);
		expect(new Date(days[6] as number).getDay()).toBe(0);
	});
});

describe("date-range — month grid", () => {
	it("startOfMonthGrid lands on a Monday for the May-2026 grid with Monday week start", () => {
		const may = epoch(2026, 4, 14);
		const start = startOfMonthGrid(may, WeekStartsOn.Monday);
		const d = new Date(start);
		expect(d.getDay()).toBe(1);
		// May 1, 2026 is a Friday → the Monday before is April 27.
		expect(d.getMonth()).toBe(3); // April
		expect(d.getDate()).toBe(27);
	});

	it("endOfMonthGrid is 41 days after start at 23:59:59.999", () => {
		const may = epoch(2026, 4, 14);
		const start = startOfMonthGrid(may, WeekStartsOn.Monday);
		const end = endOfMonthGrid(may, WeekStartsOn.Monday);
		expect(daysBetween(start, end)).toBe(41);
		const d = new Date(end);
		expect(d.getHours()).toBe(23);
	});

	it("monthGridDays returns 42 ordered start-of-day anchors", () => {
		const days = monthGridDays(epoch(2026, 4, 14), WeekStartsOn.Monday);
		expect(days).toHaveLength(42);
		for (const day of days) {
			const d = new Date(day);
			expect(d.getHours()).toBe(0);
		}
		for (let i = 1; i < days.length; i++) {
			expect((days[i] as number) > (days[i - 1] as number)).toBe(true);
		}
	});
});

describe("date-range — predicates + keys", () => {
	it("dateKey emits zero-padded YYYY-MM-DD in local tz", () => {
		expect(dateKey(epoch(2026, 0, 5))).toBe("2026-01-05");
		expect(dateKey(epoch(2026, 11, 31))).toBe("2026-12-31");
	});

	it("isSameDay collapses intra-day times", () => {
		expect(isSameDay(epoch(2026, 4, 14, 1), epoch(2026, 4, 14, 23))).toBe(true);
		expect(isSameDay(epoch(2026, 4, 14, 23), epoch(2026, 4, 15, 0))).toBe(false);
	});

	it("isSameMonth ignores day-of-month", () => {
		expect(isSameMonth(epoch(2026, 4, 1), epoch(2026, 4, 31))).toBe(true);
		expect(isSameMonth(epoch(2026, 4, 31), epoch(2026, 5, 1))).toBe(false);
	});
});
