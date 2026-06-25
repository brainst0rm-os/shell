import { describe, expect, it } from "vitest";
import { RecurrenceKind, Weekday } from "./recurrence";
import {
	MAX_OCCURRENCES,
	birthdayOccurrencesInRange,
	occurrencesInRange,
	yearlyRecurrenceForDate,
} from "./recurrence-occurrences";

/** Local-time builder so assertions are timezone-agnostic. */
const L = (y: number, m1: number, d: number, h = 0, mi = 0): number =>
	new Date(y, m1 - 1, d, h, mi, 0, 0).getTime();

describe("occurrencesInRange — guards", () => {
	const rec = { kind: RecurrenceKind.Daily, every: 1 } as const;
	it("returns [] for non-finite inputs", () => {
		expect(occurrencesInRange(Number.NaN, rec, 0, 1)).toEqual([]);
		expect(occurrencesInRange(0, rec, Number.POSITIVE_INFINITY, 1)).toEqual([]);
		expect(occurrencesInRange(0, rec, 0, Number.NaN)).toEqual([]);
	});
	it("returns [] for an inverted range", () => {
		expect(occurrencesInRange(L(2026, 1, 1), rec, L(2026, 2, 1), L(2026, 1, 1))).toEqual([]);
	});
	it("never emits an occurrence before the anchor", () => {
		const out = occurrencesInRange(L(2026, 6, 15), rec, L(2026, 6, 1), L(2026, 6, 20));
		expect(out[0]).toBe(L(2026, 6, 15));
		expect(Math.min(...out)).toBeGreaterThanOrEqual(L(2026, 6, 15));
	});
});

describe("Daily", () => {
	it("every day within the window, inclusive bounds", () => {
		const out = occurrencesInRange(
			L(2026, 6, 1),
			{ kind: RecurrenceKind.Daily, every: 1 },
			L(2026, 6, 1),
			L(2026, 6, 4),
		);
		expect(out).toEqual([L(2026, 6, 1), L(2026, 6, 2), L(2026, 6, 3), L(2026, 6, 4)]);
	});
	it("respects the interval phase", () => {
		const out = occurrencesInRange(
			L(2026, 6, 1),
			{ kind: RecurrenceKind.Daily, every: 3 },
			L(2026, 6, 1),
			L(2026, 6, 10),
		);
		expect(out).toEqual([L(2026, 6, 1), L(2026, 6, 4), L(2026, 6, 7), L(2026, 6, 10)]);
	});
	it("preserves the anchor's time-of-day", () => {
		const out = occurrencesInRange(
			L(2020, 1, 1, 9, 30),
			{ kind: RecurrenceKind.Daily, every: 1 },
			L(2026, 6, 1),
			L(2026, 6, 3),
		);
		expect(out).toEqual([L(2026, 6, 1, 9, 30), L(2026, 6, 2, 9, 30)]);
	});
	it("fast-forwards a far-past anchor without iterating every day", () => {
		const out = occurrencesInRange(
			L(1970, 1, 1),
			{ kind: RecurrenceKind.Daily, every: 1 },
			L(2026, 6, 10),
			L(2026, 6, 12),
		);
		expect(out).toEqual([L(2026, 6, 10), L(2026, 6, 11), L(2026, 6, 12)]);
	});
});

describe("Weekly", () => {
	it("emits each listed weekday, ascending", () => {
		// 2026-06-01 is a Monday.
		const out = occurrencesInRange(
			L(2026, 6, 1),
			{ kind: RecurrenceKind.Weekly, every: 1, days: [Weekday.Mon, Weekday.Wed] },
			L(2026, 6, 1),
			L(2026, 6, 14),
		);
		expect(out).toEqual([L(2026, 6, 1), L(2026, 6, 3), L(2026, 6, 8), L(2026, 6, 10)]);
	});
	it("skips off-interval weeks (every=2)", () => {
		const out = occurrencesInRange(
			L(2026, 6, 1),
			{ kind: RecurrenceKind.Weekly, every: 2, days: [Weekday.Mon] },
			L(2026, 6, 1),
			L(2026, 6, 30),
		);
		expect(out).toEqual([L(2026, 6, 1), L(2026, 6, 15), L(2026, 6, 29)]);
	});
});

describe("Monthly", () => {
	it("clamps dayOfMonth to short months", () => {
		const out = occurrencesInRange(
			L(2026, 1, 31),
			{ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 31 },
			L(2026, 1, 1),
			L(2026, 4, 30),
		);
		expect(out).toEqual([L(2026, 1, 31), L(2026, 2, 28), L(2026, 3, 31), L(2026, 4, 30)]);
	});
	it("supports the nth-weekday form (third Tuesday)", () => {
		const out = occurrencesInRange(
			L(2026, 1, 1),
			{
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: 3 },
			},
			L(2026, 1, 1),
			L(2026, 3, 31),
		);
		// Third Tuesdays: Jan 20, Feb 17, Mar 17 (2026).
		expect(out).toEqual([L(2026, 1, 20), L(2026, 2, 17), L(2026, 3, 17)]);
	});
	it("supports the last-weekday form (ordinal -1)", () => {
		const out = occurrencesInRange(
			L(2026, 1, 1),
			{
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Fri, ordinal: -1 },
			},
			L(2026, 1, 1),
			L(2026, 2, 28),
		);
		// Last Fridays: Jan 30, Feb 27 (2026).
		expect(out).toEqual([L(2026, 1, 30), L(2026, 2, 27)]);
	});
});

describe("Yearly + birthdays", () => {
	it("recurs on the same month/day each year in range", () => {
		const out = occurrencesInRange(
			L(1990, 3, 14),
			{ kind: RecurrenceKind.Yearly, month: 3, day: 14 },
			L(2024, 1, 1),
			L(2026, 12, 31),
		);
		expect(out).toEqual([L(2024, 3, 14), L(2025, 3, 14), L(2026, 3, 14)]);
	});
	it("clamps Feb 29 to Feb 28 in non-leap years, keeps it in leap years", () => {
		const out = occurrencesInRange(
			L(2000, 2, 29),
			{ kind: RecurrenceKind.Yearly, month: 2, day: 29 },
			L(2023, 1, 1),
			L(2024, 12, 31),
		);
		expect(out).toEqual([L(2023, 2, 28), L(2024, 2, 29)]);
	});
	it("birthdayOccurrencesInRange derives the day-of-year from the stored date", () => {
		const bday = L(1985, 7, 9);
		expect(birthdayOccurrencesInRange(bday, L(2025, 1, 1), L(2026, 12, 31))).toEqual([
			L(2025, 7, 9),
			L(2026, 7, 9),
		]);
	});
	it("yearlyRecurrenceForDate returns the local month/day, null on bad input", () => {
		expect(yearlyRecurrenceForDate(L(1985, 7, 9))).toEqual({
			kind: RecurrenceKind.Yearly,
			month: 7,
			day: 9,
		});
		expect(yearlyRecurrenceForDate(Number.NaN)).toBeNull();
		expect(birthdayOccurrencesInRange(Number.NaN, 0, 1)).toEqual([]);
	});
});

describe("Custom + caps", () => {
	it("Custom degrades to just the anchor when in range, [] otherwise", () => {
		const rec = { kind: RecurrenceKind.Custom, rrule: "FREQ=HOURLY" } as const;
		expect(occurrencesInRange(L(2026, 6, 1), rec, L(2026, 5, 1), L(2026, 7, 1))).toEqual([
			L(2026, 6, 1),
		]);
		expect(occurrencesInRange(L(2026, 6, 1), rec, L(2026, 7, 1), L(2026, 8, 1))).toEqual([]);
	});
	it("truncates at the cap and never exceeds MAX_OCCURRENCES", () => {
		const capped = occurrencesInRange(
			L(2026, 1, 1),
			{ kind: RecurrenceKind.Daily, every: 1 },
			L(2026, 1, 1),
			L(2026, 12, 31),
			{ maxOccurrences: 5 },
		);
		expect(capped).toHaveLength(5);
		const huge = occurrencesInRange(
			L(1900, 1, 1),
			{ kind: RecurrenceKind.Daily, every: 1 },
			L(1900, 1, 1),
			L(2100, 1, 1),
			{ maxOccurrences: 9_999_999 },
		);
		expect(huge.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
	});
});
