import { describe, expect, it } from "vitest";
import type { Event } from "../types/event";
import { addDay, dateKey, endOfDay, indexByDay, isUpcoming, startOfDay } from "./event-occurrences";

function event(overrides: Partial<Event> & { id: string; start: number }): Event {
	return {
		title: overrides.id,
		end: null,
		allDay: false,
		location: null,
		recurrence: null,
		statusKey: null,
		colorHint: null,
		reminders: [],
		attendees: [],
		timeZone: null,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function localTime(y: number, m: number, d: number, hh = 0, mm = 0): number {
	return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}
function localDay(y: number, m: number, d: number): number {
	return localTime(y, m, d);
}

describe("dateKey / startOfDay / endOfDay", () => {
	it("dateKey emits YYYY-MM-DD in local tz", () => {
		expect(dateKey(localDay(2026, 5, 14))).toBe("2026-05-14");
		expect(dateKey(localTime(2026, 1, 3, 9, 0))).toBe("2026-01-03");
	});

	it("startOfDay anchors to local midnight", () => {
		const noon = localTime(2026, 5, 14, 12, 0);
		expect(startOfDay(noon)).toBe(localDay(2026, 5, 14));
	});

	it("endOfDay anchors to 23:59:59.999 local", () => {
		const noon = localTime(2026, 5, 14, 12, 0);
		const expected = new Date(2026, 4, 14, 23, 59, 59, 999).getTime();
		expect(endOfDay(noon)).toBe(expected);
	});
});

describe("addDay", () => {
	it("walks one calendar day forward via setDate (DST-safe)", () => {
		const d1 = localDay(2026, 3, 7);
		expect(dateKey(addDay(d1))).toBe("2026-03-08");
	});

	it("crosses a month boundary correctly", () => {
		expect(dateKey(addDay(localDay(2026, 1, 31)))).toBe("2026-02-01");
	});

	it("crosses a year boundary correctly", () => {
		expect(dateKey(addDay(localDay(2026, 12, 31)))).toBe("2027-01-01");
	});
});

describe("indexByDay — single-day events", () => {
	it("buckets instant events into the single day their start falls on", () => {
		const events: Event[] = [
			event({ id: "morning", start: localTime(2026, 5, 14, 9, 0) }),
			event({ id: "afternoon", start: localTime(2026, 5, 14, 15, 0) }),
			event({ id: "next-day", start: localTime(2026, 5, 15, 9, 0) }),
		];
		const buckets = indexByDay(events);
		expect(buckets.map((b) => b.key)).toEqual(["2026-05-14", "2026-05-15"]);
		expect(buckets[0]?.events.map((e) => e.id)).toEqual(["morning", "afternoon"]);
		expect(buckets[1]?.events.map((e) => e.id)).toEqual(["next-day"]);
	});

	it("sorts events within a day by start ascending — regardless of input order", () => {
		const events: Event[] = [
			event({ id: "late", start: localTime(2026, 5, 14, 18, 0) }),
			event({ id: "early", start: localTime(2026, 5, 14, 7, 30) }),
		];
		const buckets = indexByDay(events);
		expect(buckets[0]?.events.map((e) => e.id)).toEqual(["early", "late"]);
	});
});

describe("indexByDay — multi-day events", () => {
	it("registers a 3-day event in each of the 3 day buckets", () => {
		const events: Event[] = [
			event({
				id: "trip",
				start: localTime(2026, 5, 14, 8, 0),
				end: localTime(2026, 5, 16, 17, 0),
			}),
		];
		const buckets = indexByDay(events);
		expect(buckets.map((b) => b.key)).toEqual(["2026-05-14", "2026-05-15", "2026-05-16"]);
		for (const bucket of buckets) {
			expect(bucket.events.map((e) => e.id)).toEqual(["trip"]);
		}
	});

	it("merges multi-day events alongside single-day events in the same bucket", () => {
		const events: Event[] = [
			event({
				id: "trip",
				start: localTime(2026, 5, 14, 8, 0),
				end: localTime(2026, 5, 16, 17, 0),
			}),
			event({ id: "lunch", start: localTime(2026, 5, 15, 12, 0) }),
		];
		const buckets = indexByDay(events);
		const mid = buckets.find((b) => b.key === "2026-05-15");
		expect(mid?.events.map((e) => e.id).sort()).toEqual(["lunch", "trip"]);
	});
});

describe("indexByDay — output ordering + empty cases", () => {
	it("buckets come back sorted ascending by date", () => {
		const events: Event[] = [
			event({ id: "c", start: localDay(2026, 5, 20) }),
			event({ id: "a", start: localDay(2026, 5, 14) }),
			event({ id: "b", start: localDay(2026, 5, 17) }),
		];
		const buckets = indexByDay(events);
		expect(buckets.map((b) => b.startOfDay)).toEqual([
			localDay(2026, 5, 14),
			localDay(2026, 5, 17),
			localDay(2026, 5, 20),
		]);
	});

	it("returns an empty array for no events", () => {
		expect(indexByDay([])).toEqual([]);
	});
});

describe("isUpcoming", () => {
	const NOW = localTime(2026, 5, 14, 10, 0);

	it("true when an instant event starts in the future", () => {
		expect(isUpcoming(event({ id: "future", start: NOW + 3600_000 }), NOW)).toBe(true);
	});

	it("false when an instant event is in the past", () => {
		expect(isUpcoming(event({ id: "past", start: NOW - 3600_000 }), NOW)).toBe(false);
	});

	it("uses end for ongoing multi-day events — an event that started yesterday but ends tomorrow is still upcoming", () => {
		const ev = event({
			id: "ongoing",
			start: NOW - 86_400_000,
			end: NOW + 86_400_000,
		});
		expect(isUpcoming(ev, NOW)).toBe(true);
	});

	it("strict — an event ending exactly at `now` is no longer upcoming", () => {
		const ev = event({ id: "edge", start: NOW - 3600_000, end: NOW });
		expect(isUpcoming(ev, NOW)).toBe(false);
	});
});
