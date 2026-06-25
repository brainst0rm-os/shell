import { describe, expect, it } from "vitest";
import { RecurrenceKind, Weekday } from "./recurrence";
import { recurrenceToRRule, rruleToRecurrence } from "./recurrence-rrule";

describe("rruleToRecurrence", () => {
	it("maps DAILY with interval", () => {
		expect(rruleToRecurrence("FREQ=DAILY;INTERVAL=2")).toEqual({
			kind: RecurrenceKind.Daily,
			every: 2,
		});
		expect(rruleToRecurrence("FREQ=DAILY")).toEqual({ kind: RecurrenceKind.Daily, every: 1 });
	});

	it("strips a leading RRULE: prefix and is case-insensitive on FREQ", () => {
		expect(rruleToRecurrence("RRULE:FREQ=daily")).toEqual({ kind: RecurrenceKind.Daily, every: 1 });
	});

	it("maps WEEKLY with BYDAY", () => {
		expect(rruleToRecurrence("FREQ=WEEKLY;BYDAY=MO,WE")).toEqual({
			kind: RecurrenceKind.Weekly,
			every: 1,
			days: [Weekday.Mon, Weekday.Wed],
		});
	});

	it("degrades WEEKLY without BYDAY to Custom", () => {
		expect(rruleToRecurrence("FREQ=WEEKLY")).toEqual({
			kind: RecurrenceKind.Custom,
			rrule: "FREQ=WEEKLY",
		});
	});

	it("maps MONTHLY by month-day and by ordinal weekday", () => {
		expect(rruleToRecurrence("FREQ=MONTHLY;BYMONTHDAY=15")).toEqual({
			kind: RecurrenceKind.Monthly,
			every: 1,
			dayOfMonth: 15,
		});
		expect(rruleToRecurrence("FREQ=MONTHLY;BYDAY=-1FR")).toEqual({
			kind: RecurrenceKind.Monthly,
			every: 1,
			dayOfWeek: { weekday: Weekday.Fri, ordinal: -1 },
		});
	});

	it("maps an annual YEARLY by month + day", () => {
		expect(rruleToRecurrence("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14")).toEqual({
			kind: RecurrenceKind.Yearly,
			month: 3,
			day: 14,
		});
	});

	it("degrades a non-annual YEARLY (INTERVAL>1) to Custom — YearlyRecurrence has no interval", () => {
		// Regression: previously parsed to a yearly (every-1) recurrence, so a
		// biennial rule fired annually. Now preserved verbatim as Custom.
		const r = "FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYMONTHDAY=15";
		expect(rruleToRecurrence(r)).toEqual({ kind: RecurrenceKind.Custom, rrule: r });
	});

	it("returns null only for an empty string; preserves unparseable rules as Custom", () => {
		expect(rruleToRecurrence("")).toBeNull();
		expect(rruleToRecurrence("FREQ=HOURLY;INTERVAL=6")).toEqual({
			kind: RecurrenceKind.Custom,
			rrule: "FREQ=HOURLY;INTERVAL=6",
		});
	});

	it("round-trips structured kinds through recurrenceToRRule", () => {
		const weekly = {
			kind: RecurrenceKind.Weekly,
			every: 2,
			days: [Weekday.Mon, Weekday.Wed],
		} as const;
		expect(rruleToRecurrence(recurrenceToRRule(weekly))).toEqual(weekly);
	});
});
