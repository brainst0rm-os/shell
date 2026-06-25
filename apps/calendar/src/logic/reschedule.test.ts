import { describe, expect, it } from "vitest";
import type { Event } from "../types/event";
import { rescheduleEvent, shiftToDay, snapToMinutes } from "./reschedule";

const HOUR = 3_600_000;
const DAY = 86_400_000;

function event(over: Partial<Event> = {}): Event {
	return {
		id: "e1",
		title: "Standup",
		icon: null,
		start: 1_700_000_000_000,
		end: 1_700_000_000_000 + HOUR,
		allDay: false,
		location: null,
		recurrence: null,
		statusKey: null,
		colorHint: null,
		reminders: [],
		attendees: [],
		timeZone: null,
		createdAt: 1,
		updatedAt: 1,
		...over,
	};
}

describe("snapToMinutes", () => {
	it("snaps to the nearest step boundary", () => {
		const base = Date.UTC(2026, 0, 1, 9, 7); // 09:07
		expect(snapToMinutes(base, 15)).toBe(Date.UTC(2026, 0, 1, 9, 0));
		expect(snapToMinutes(Date.UTC(2026, 0, 1, 9, 8), 15)).toBe(Date.UTC(2026, 0, 1, 9, 15));
	});
});

describe("rescheduleEvent", () => {
	it("moves start and shifts end by the same delta (duration preserved)", () => {
		const e = event();
		const moved = rescheduleEvent(e, e.start + 2 * HOUR);
		expect(moved.start).toBe(e.start + 2 * HOUR);
		expect(moved.end).toBe((e.end as number) + 2 * HOUR);
		expect((moved.end as number) - moved.start).toBe(HOUR);
	});

	it("keeps end null for an instant event", () => {
		const moved = rescheduleEvent(event({ end: null }), 1_700_000_000_000 + HOUR);
		expect(moved.end).toBeNull();
	});

	it("does not mutate the input", () => {
		const e = event();
		const before = { ...e };
		rescheduleEvent(e, e.start + HOUR);
		expect(e).toEqual(before);
	});

	it("bumps updatedAt", () => {
		const moved = rescheduleEvent(event({ updatedAt: 1 }), 1_700_000_000_000 + HOUR);
		expect(moved.updatedAt).toBeGreaterThan(1);
	});

	it("preserves duration across a cross-day reschedule", () => {
		const e = event();
		const moved = rescheduleEvent(e, e.start + 3 * DAY);
		expect(moved.start).toBe(e.start + 3 * DAY);
		expect((moved.end as number) - moved.start).toBe(HOUR);
	});
});

describe("shiftToDay", () => {
	it("keeps the same wall-clock time on the target day", () => {
		const origin = new Date(2026, 0, 5, 9, 30).getTime(); // Mon 09:30 local
		const targetDayStart = new Date(2026, 0, 7, 0, 0).getTime(); // Wed 00:00
		const shifted = shiftToDay(origin, targetDayStart);
		const d = new Date(shifted);
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(0);
		expect(d.getDate()).toBe(7);
		expect(d.getHours()).toBe(9);
		expect(d.getMinutes()).toBe(30);
	});

	it("all-day items (00:00) stay at 00:00 on the target day", () => {
		const origin = new Date(2026, 0, 5, 0, 0).getTime();
		const targetDayStart = new Date(2026, 0, 9, 0, 0).getTime();
		const shifted = shiftToDay(origin, targetDayStart);
		expect(shifted).toBe(targetDayStart);
	});

	it("idempotent when target is the same day as origin", () => {
		const origin = new Date(2026, 0, 5, 14, 45).getTime();
		const sameDayStart = new Date(2026, 0, 5, 0, 0).getTime();
		expect(shiftToDay(origin, sameDayStart)).toBe(origin);
	});

	it("composes with rescheduleEvent to move days while preserving duration", () => {
		const start = new Date(2026, 0, 5, 9, 0).getTime();
		const e = event({ start, end: start + 2 * HOUR });
		const targetDayStart = new Date(2026, 0, 8, 0, 0).getTime();
		const moved = rescheduleEvent(e, shiftToDay(e.start, targetDayStart));
		expect(new Date(moved.start).getDate()).toBe(8);
		expect(new Date(moved.start).getHours()).toBe(9);
		expect((moved.end as number) - moved.start).toBe(2 * HOUR);
	});
});
