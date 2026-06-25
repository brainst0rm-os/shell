import { describe, expect, it } from "vitest";
import {
	ALL_RELATIVE_DATE_RANGES,
	RelativeDateRange,
	isInRelativeRange,
	relativeRangeLabel,
	resolveRelativeRange,
	toTimestamp,
} from "./relative-date";

// A fixed reference instant: Wednesday 2024-06-12, 15:30 local time. Using a
// mid-day, mid-week, mid-month, mid-year point exercises every boundary.
const NOW = new Date(2024, 5, 12, 15, 30, 0).getTime();
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime();

describe("resolveRelativeRange — single-day windows", () => {
	it("Today is [local midnight, next midnight)", () => {
		const w = resolveRelativeRange(RelativeDateRange.Today, NOW);
		expect(w.start).toBe(at(2024, 5, 12, 0));
		expect(w.end).toBe(at(2024, 5, 13, 0));
	});
	it("Yesterday and Tomorrow shift one day", () => {
		expect(resolveRelativeRange(RelativeDateRange.Yesterday, NOW)).toEqual({
			start: at(2024, 5, 11, 0),
			end: at(2024, 5, 12, 0),
		});
		expect(resolveRelativeRange(RelativeDateRange.Tomorrow, NOW)).toEqual({
			start: at(2024, 5, 13, 0),
			end: at(2024, 5, 14, 0),
		});
	});
});

describe("resolveRelativeRange — trailing / leading windows", () => {
	it("Last7Days includes today + the 6 prior days", () => {
		const w = resolveRelativeRange(RelativeDateRange.Last7Days, NOW);
		expect(w.start).toBe(at(2024, 5, 6, 0)); // Jun 6
		expect(w.end).toBe(at(2024, 5, 13, 0)); // tomorrow midnight
	});
	it("Last30Days spans 30 days ending tomorrow midnight", () => {
		const w = resolveRelativeRange(RelativeDateRange.Last30Days, NOW);
		expect(w.start).toBe(new Date(2024, 4, 14, 0).getTime()); // May 14 (crosses month)
		expect(w.end).toBe(at(2024, 5, 13, 0));
	});
	it("Next7Days is today through 7 days out", () => {
		const w = resolveRelativeRange(RelativeDateRange.Next7Days, NOW);
		expect(w.start).toBe(at(2024, 5, 12, 0));
		expect(w.end).toBe(at(2024, 5, 19, 0));
	});
});

describe("resolveRelativeRange — calendar windows", () => {
	it("ThisWeek runs Monday→Monday (Jun 12 is a Wednesday)", () => {
		const w = resolveRelativeRange(RelativeDateRange.ThisWeek, NOW);
		expect(w.start).toBe(at(2024, 5, 10, 0)); // Mon Jun 10
		expect(w.end).toBe(at(2024, 5, 17, 0)); // Mon Jun 17
	});
	it("ThisMonth is the 1st through the next 1st", () => {
		expect(resolveRelativeRange(RelativeDateRange.ThisMonth, NOW)).toEqual({
			start: new Date(2024, 5, 1).getTime(),
			end: new Date(2024, 6, 1).getTime(),
		});
	});
	it("ThisYear is Jan 1 through next Jan 1", () => {
		expect(resolveRelativeRange(RelativeDateRange.ThisYear, NOW)).toEqual({
			start: new Date(2024, 0, 1).getTime(),
			end: new Date(2025, 0, 1).getTime(),
		});
	});
});

describe("live-rolling: same range, different now → different window", () => {
	it("Today rolls forward with the clock", () => {
		const a = resolveRelativeRange(RelativeDateRange.Today, NOW);
		const b = resolveRelativeRange(RelativeDateRange.Today, NOW + 24 * 60 * 60 * 1000);
		expect(b.start).toBeGreaterThan(a.start);
	});
});

describe("isInRelativeRange", () => {
	it("includes a value inside the window (half-open)", () => {
		expect(isInRelativeRange(at(2024, 5, 12, 9), RelativeDateRange.Today, NOW)).toBe(true);
	});
	it("excludes the exact end (next midnight is the next day's Today)", () => {
		expect(isInRelativeRange(at(2024, 5, 13, 0), RelativeDateRange.Today, NOW)).toBe(false);
	});
	it("accepts ISO strings and ms numbers", () => {
		expect(isInRelativeRange("2024-06-12T08:00:00", RelativeDateRange.Today, NOW)).toBe(true);
		expect(isInRelativeRange(at(2024, 5, 11), RelativeDateRange.Today, NOW)).toBe(false);
	});
	it("treats a non-date value as out of range", () => {
		expect(isInRelativeRange("not a date", RelativeDateRange.Today, NOW)).toBe(false);
		expect(isInRelativeRange(null, RelativeDateRange.ThisMonth, NOW)).toBe(false);
		expect(isInRelativeRange(42, RelativeDateRange.Today, NOW)).toBe(false);
	});
});

describe("toTimestamp", () => {
	it("accepts timestamp-window numbers and parseable strings, rejects others", () => {
		expect(toTimestamp(at(2024, 5, 12))).toBe(at(2024, 5, 12));
		expect(toTimestamp("2024-06-12")).toBe(Date.parse("2024-06-12"));
		expect(toTimestamp(5)).toBeNull();
		expect(toTimestamp("nope")).toBeNull();
		expect(toTimestamp(null)).toBeNull();
	});
});

describe("relativeRangeLabel", () => {
	it("gives a human label for every range (no raw camelCase leaks)", () => {
		for (const range of ALL_RELATIVE_DATE_RANGES) {
			const label = relativeRangeLabel(range);
			expect(label).not.toBe(range);
			expect(label.length).toBeGreaterThan(0);
		}
		expect(relativeRangeLabel(RelativeDateRange.Last7Days)).toBe("Last 7 days");
		expect(relativeRangeLabel(RelativeDateRange.ThisMonth)).toBe("This month");
	});

	it("passes an unknown token through unchanged (forward-incompatible filter)", () => {
		expect(relativeRangeLabel("last90Days")).toBe("last90Days");
	});
});
