import { describe, expect, it } from "vitest";
import type { MonthDayCell } from "./compile-view";
import { layoutMonthRibbons } from "./ribbon-layout";
import { EVENT_SOURCE_KEY, type ScheduledItem } from "./scheduled-item";

const DAY = 86_400_000;
const BASE = new Date(2026, 4, 1, 0, 0, 0).getTime();

function span(id: string, days: number): ScheduledItem {
	return {
		id,
		sourceKey: EVENT_SOURCE_KEY,
		sourceEntityId: id,
		title: id,
		icon: null,
		start: BASE,
		end: BASE + days * DAY,
		allDay: false,
		location: null,
		recurrence: null,
		colorHint: null,
	};
}

/** 42 empty cells; `place` maps a cell index → the span items on that day. */
function grid(place: Record<number, ScheduledItem[]>): MonthDayCell[] {
	return Array.from({ length: 42 }, (_, i) => ({
		dayStart: i,
		dateKey: String(i),
		dayOfMonth: (i % 31) + 1,
		isOtherMonth: false,
		isToday: false,
		isWeekend: false,
		allDayItems: place[i] ?? [],
		timedItems: [],
	}));
}

describe("layoutMonthRibbons", () => {
	it("emits one rounded segment for a span inside a single week", () => {
		const s = span("a", 2);
		const layout = layoutMonthRibbons(grid({ 2: [s], 3: [s], 4: [s] }));
		expect(layout.segments).toHaveLength(1);
		expect(layout.segments[0]).toMatchObject({
			week: 0,
			lane: 0,
			startCol: 2,
			endCol: 4,
			roundedLeft: true,
			roundedRight: true,
		});
		expect(layout.laneCountByWeek[0]).toBe(1);
	});

	it("splits a week-crossing span into two segments with the right caps", () => {
		const s = span("b", 3);
		// cols 5,6 of week 0 + cols 0,1 of week 1 (cells 5,6,7,8).
		const layout = layoutMonthRibbons(grid({ 5: [s], 6: [s], 7: [s], 8: [s] }));
		expect(layout.segments).toHaveLength(2);
		const [first, second] = layout.segments;
		expect(first).toMatchObject({
			week: 0,
			startCol: 5,
			endCol: 6,
			roundedLeft: true,
			roundedRight: false,
		});
		expect(second).toMatchObject({
			week: 1,
			startCol: 0,
			endCol: 1,
			roundedLeft: false,
			roundedRight: true,
		});
	});

	it("stacks overlapping spans onto distinct lanes", () => {
		const a = span("a", 3);
		const b = span("b", 2);
		const layout = layoutMonthRibbons(grid({ 1: [a], 2: [a, b], 3: [a, b], 4: [b] }));
		const lanes = new Map(layout.segments.map((s) => [s.item.id, s.lane]));
		expect(lanes.get("a")).not.toBe(lanes.get("b"));
		expect(layout.laneCountByWeek[0]).toBe(2);
	});

	it("ignores single-day items", () => {
		const single = span("x", 0); // end == start → not multi-day
		const layout = layoutMonthRibbons(grid({ 3: [single] }));
		expect(layout.segments).toHaveLength(0);
	});
});
