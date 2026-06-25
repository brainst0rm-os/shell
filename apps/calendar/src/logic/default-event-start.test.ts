import { describe, expect, it } from "vitest";
import { startOfDay } from "./date-range";
import { defaultEventStart, nextFullHour } from "./default-event-start";

const HOUR_MS = 3_600_000;

function at(iso: string): number {
	return new Date(iso).getTime();
}

describe("nextFullHour", () => {
	it("rounds up to the next hour boundary", () => {
		expect(nextFullHour(at("2026-06-11T14:23:45.500"))).toBe(at("2026-06-11T15:00:00"));
		expect(nextFullHour(at("2026-06-11T14:59:59.999"))).toBe(at("2026-06-11T15:00:00"));
	});

	it("keeps an instant already on a full hour", () => {
		expect(nextFullHour(at("2026-06-11T15:00:00"))).toBe(at("2026-06-11T15:00:00"));
	});

	it("rolls into the next day after 23:00", () => {
		expect(nextFullHour(at("2026-06-11T23:30:00"))).toBe(at("2026-06-12T00:00:00"));
	});
});

describe("defaultEventStart", () => {
	it("with no day selection: today at the next full hour (NOT the view anchor)", () => {
		const now = at("2026-06-11T14:23:00");
		expect(defaultEventStart({ selectedDayStart: null, now })).toBe(at("2026-06-11T15:00:00"));
	});

	it("with the selected day = today: next full hour today", () => {
		const now = at("2026-06-11T09:05:00");
		const today = startOfDay(now);
		expect(defaultEventStart({ selectedDayStart: today, now })).toBe(at("2026-06-11T10:00:00"));
	});

	it("with a selected day elsewhere: that day at the next-full-hour wall-clock", () => {
		const now = at("2026-06-11T14:23:00");
		const selected = startOfDay(at("2026-06-20T00:00:00"));
		expect(defaultEventStart({ selectedDayStart: selected, now })).toBe(at("2026-06-20T15:00:00"));
	});

	it("never regresses to the first of the month (F-218 repro)", () => {
		// June 11, month view: the old code used the month anchor (June 1 09:00).
		const now = at("2026-06-11T10:42:00");
		const start = defaultEventStart({ selectedDayStart: null, now });
		expect(startOfDay(start)).toBe(startOfDay(now));
		expect(start).toBeGreaterThanOrEqual(now);
		expect(start - now).toBeLessThanOrEqual(HOUR_MS);
	});

	it("selected day near midnight maps the rolled-over hour onto the selected day", () => {
		const now = at("2026-06-11T23:30:00");
		const selected = startOfDay(at("2026-06-20T00:00:00"));
		expect(defaultEventStart({ selectedDayStart: selected, now })).toBe(at("2026-06-20T00:00:00"));
	});
});
