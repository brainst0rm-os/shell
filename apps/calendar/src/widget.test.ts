import { describe, expect, it } from "vitest";
import { computeWeekAhead } from "./widget";

/** A fixed local-noon anchor so the 7-day window math is stable. */
const NOW = new Date(2026, 5, 21, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function ev(id: string, start: number, allDay = false) {
	return { id, title: id, start, allDay };
}

describe("computeWeekAhead", () => {
	it("includes today through the next 6 days and excludes outside the window", () => {
		const groups = computeWeekAhead(
			[
				ev("yesterday", NOW - DAY),
				ev("today", NOW + 60 * 60 * 1000),
				ev("in6", NOW + 6 * DAY),
				ev("in7", NOW + 7 * DAY),
			],
			NOW,
		);
		const ids = groups.flatMap((g) => g.events.map((e) => e.id));
		expect(ids).toContain("today");
		expect(ids).toContain("in6");
		expect(ids).not.toContain("yesterday");
		expect(ids).not.toContain("in7");
	});

	it("groups by local day, day-ascending", () => {
		const groups = computeWeekAhead([ev("d2", NOW + 2 * DAY), ev("d1", NOW + 1 * DAY)], NOW);
		expect(groups).toHaveLength(2);
		expect(groups[0]?.events[0]?.id).toBe("d1");
		expect(groups[1]?.events[0]?.id).toBe("d2");
	});

	it("orders all-day events before timed ones within a day, then by start", () => {
		const dayStart = new Date(2026, 5, 22, 0, 0, 0).getTime();
		const groups = computeWeekAhead(
			[
				ev("timed-pm", dayStart + 15 * 60 * 60 * 1000),
				ev("timed-am", dayStart + 9 * 60 * 60 * 1000),
				ev("allday", dayStart, true),
			],
			NOW,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.events.map((e) => e.id)).toEqual(["allday", "timed-am", "timed-pm"]);
	});

	it("returns no groups for an empty window", () => {
		expect(computeWeekAhead([ev("far", NOW + 30 * DAY)], NOW)).toEqual([]);
	});
});
