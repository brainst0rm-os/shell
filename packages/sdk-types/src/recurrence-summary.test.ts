import { describe, expect, it } from "vitest";
import { RecurrenceKind, Weekday } from "./recurrence";
import {
	DEFAULT_RECURRENCE_LABELS,
	type RecurrenceSummaryLabels,
	summarizeRecurrence,
} from "./recurrence-summary";

describe("summarizeRecurrence — Daily", () => {
	it("every=1 → daily phrase", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Daily, every: 1 })).toBe("Every day");
	});
	it("every>1 → N-days phrase", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Daily, every: 3 })).toBe("Every 3 days");
	});
});

describe("summarizeRecurrence — Weekly", () => {
	it("renders days in canonical ISO order regardless of input order", () => {
		expect(
			summarizeRecurrence({
				kind: RecurrenceKind.Weekly,
				every: 1,
				days: [Weekday.Wed, Weekday.Mon],
			}),
		).toBe("Weekly on Mon, Wed");
	});
	it("every>1 → N-weeks phrase", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Weekly, every: 2, days: [Weekday.Fri] })).toBe(
			"Every 2 weeks on Fri",
		);
	});
});

describe("summarizeRecurrence — Monthly", () => {
	it("dayOfMonth, every=1", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Monthly, every: 1, dayOfMonth: 15 })).toBe(
			"Monthly on day 15",
		);
	});
	it("dayOfMonth, every>1", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Monthly, every: 3, dayOfMonth: 1 })).toBe(
			"Every 3 months on day 1",
		);
	});
	it("nth weekday", () => {
		expect(
			summarizeRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 1,
				dayOfWeek: { weekday: Weekday.Tue, ordinal: 3 },
			}),
		).toBe("Monthly on the third Tue");
	});
	it("last weekday (ordinal -1), every>1", () => {
		expect(
			summarizeRecurrence({
				kind: RecurrenceKind.Monthly,
				every: 2,
				dayOfWeek: { weekday: Weekday.Fri, ordinal: -1 },
			}),
		).toBe("Every 2 months on the last Fri");
	});
});

describe("summarizeRecurrence — Yearly / Custom / degenerate", () => {
	it("yearly names the month", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Yearly, month: 3, day: 14 })).toBe(
			"Yearly on March 14",
		);
	});
	it("custom is opaque", () => {
		expect(summarizeRecurrence({ kind: RecurrenceKind.Custom, rrule: "FREQ=HOURLY" })).toBe(
			"Custom recurrence",
		);
	});
	it("null / undefined / malformed → none, never throws", () => {
		expect(summarizeRecurrence(null)).toBe("Does not repeat");
		expect(summarizeRecurrence(undefined)).toBe("Does not repeat");
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
		expect(summarizeRecurrence({ kind: "bogus" } as any)).toBe("Does not repeat");
	});
});

describe("custom injected labels (i18n path)", () => {
	it("uses the caller's translated closures, not the English pack", () => {
		const fr: RecurrenceSummaryLabels = {
			...DEFAULT_RECURRENCE_LABELS,
			yearlyOn: (m, d) => `Chaque année le ${d} ${m}`,
			monthName: (m) => ["janv.", "févr.", "mars"][m - 1] ?? String(m),
		};
		expect(summarizeRecurrence({ kind: RecurrenceKind.Yearly, month: 3, day: 14 }, fr)).toBe(
			"Chaque année le 14 mars",
		);
	});
});
