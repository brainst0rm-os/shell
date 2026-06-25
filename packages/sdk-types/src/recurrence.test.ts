import { describe, expect, it } from "vitest";
import { type Recurrence, RecurrenceKind, WEEKDAYS, Weekday, isRecurrence } from "./recurrence";

describe("WEEKDAYS", () => {
	it("contains seven weekdays in ISO order, starting Mon", () => {
		expect(WEEKDAYS).toEqual([
			Weekday.Mon,
			Weekday.Tue,
			Weekday.Wed,
			Weekday.Thu,
			Weekday.Fri,
			Weekday.Sat,
			Weekday.Sun,
		]);
	});

	it("is frozen — tampering at runtime can't mutate the canonical order", () => {
		expect(Object.isFrozen(WEEKDAYS)).toBe(true);
	});
});

describe("isRecurrence — Daily", () => {
	it("accepts every >= 1", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Daily, every: 1 })).toBe(true);
		expect(isRecurrence({ kind: RecurrenceKind.Daily, every: 7 })).toBe(true);
	});

	it("rejects every < 1, non-finite, missing", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Daily, every: 0 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Daily, every: -3 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Daily, every: Number.POSITIVE_INFINITY })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Daily })).toBe(false);
	});
});

describe("isRecurrence — Weekly", () => {
	it("accepts a non-empty unique day set", () => {
		expect(
			isRecurrence({
				kind: RecurrenceKind.Weekly,
				every: 1,
				days: [Weekday.Mon, Weekday.Wed, Weekday.Fri],
			}),
		).toBe(true);
	});

	it("rejects empty days, duplicates, unknown weekday strings", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Weekly, every: 1, days: [] })).toBe(false);
		expect(
			isRecurrence({
				kind: RecurrenceKind.Weekly,
				every: 1,
				days: [Weekday.Mon, Weekday.Mon],
			}),
		).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Weekly, every: 1, days: ["monday"] })).toBe(false);
	});
});

describe("isRecurrence — Monthly", () => {
	it("accepts exactly one of dayOfMonth or dayOfWeek", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 15 })).toBe(true);
		expect(
			isRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: 3 },
			}),
		).toBe(true);
	});

	it("rejects both set, neither set, dayOfMonth out of 1..31, bad ordinal", () => {
		expect(
			isRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfMonth: 15,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: 3 },
			}),
		).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Monthly, every: 1 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 0 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 32 })).toBe(false);
		expect(
			isRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: 5 },
			}),
		).toBe(false);
	});

	it("accepts -1 ordinal (last Tuesday of the month)", () => {
		expect(
			isRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: -1 },
			}),
		).toBe(true);
	});
});

describe("isRecurrence — Yearly", () => {
	it("accepts month 1..12 + day 1..31", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 1, day: 1 })).toBe(true);
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 12, day: 31 })).toBe(true);
	});

	it("rejects out-of-range month or day", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 0, day: 15 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 13, day: 15 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 6, day: 0 })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Yearly, month: 6, day: 32 })).toBe(false);
	});
});

describe("isRecurrence — Custom", () => {
	it("accepts a non-empty rrule string", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Custom, rrule: "FREQ=DAILY" })).toBe(true);
	});

	it("rejects empty / non-string rrule", () => {
		expect(isRecurrence({ kind: RecurrenceKind.Custom, rrule: "" })).toBe(false);
		expect(isRecurrence({ kind: RecurrenceKind.Custom })).toBe(false);
	});
});

describe("isRecurrence — non-Recurrence input", () => {
	it("rejects null / undefined / primitives / unknown kinds", () => {
		expect(isRecurrence(null)).toBe(false);
		expect(isRecurrence(undefined)).toBe(false);
		expect(isRecurrence("daily")).toBe(false);
		expect(isRecurrence(42)).toBe(false);
		expect(isRecurrence({ kind: "biweekly", every: 2 })).toBe(false);
	});
});

describe("Recurrence union discriminator", () => {
	it("compiles every variant against the exported union", () => {
		const samples: Recurrence[] = [
			{ kind: RecurrenceKind.Daily, every: 2 },
			{ kind: RecurrenceKind.Weekly, every: 1, days: [Weekday.Mon] },
			{ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 1 },
			{
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Fri, ordinal: -1 },
			},
			{ kind: RecurrenceKind.Yearly, month: 2, day: 14 },
			{ kind: RecurrenceKind.Custom, rrule: "FREQ=DAILY;INTERVAL=3" },
		];
		for (const sample of samples) expect(isRecurrence(sample)).toBe(true);
	});
});
