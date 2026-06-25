import { describe, expect, it } from "vitest";
import { compileYearView } from "./compile-view";
import { EVENT_SOURCE_KEY, type ScheduledItem } from "./scheduled-item";

function item(id: string, start: number, end: number | null = null): ScheduledItem {
	return {
		id,
		sourceKey: EVENT_SOURCE_KEY,
		sourceEntityId: id,
		title: id,
		icon: null,
		start,
		end,
		allDay: false,
		location: null,
		recurrence: null,
		colorHint: null,
	};
}

const NOW = new Date(2026, 4, 14, 12, 0, 0).getTime();

describe("compileYearView", () => {
	it("emits 12 months for the anchor's year", () => {
		const compiled = compileYearView([], { anchor: NOW, weekStartsOn: 1, now: NOW });
		expect(compiled.year).toBe(2026);
		expect(compiled.months).toHaveLength(12);
		expect(compiled.months[0]?.monthIndex).toBe(0);
		expect(compiled.months[11]?.monthIndex).toBe(11);
	});

	it("counts day density and the month total", () => {
		const may1 = new Date(2026, 4, 1, 9, 0).getTime();
		const compiled = compileYearView(
			[item("a", may1), item("b", may1), item("c", new Date(2026, 4, 2, 9).getTime())],
			{ anchor: NOW, weekStartsOn: 1, now: NOW },
		);
		const may = compiled.months[4];
		expect(may?.total).toBe(3);
		const day1 = may?.days.find((d) => !d.isOtherMonth && d.dayOfMonth === 1);
		expect(day1?.count).toBe(2);
	});

	it("spreads a multi-day span across each day it covers", () => {
		const start = new Date(2026, 5, 10, 9).getTime();
		const end = new Date(2026, 5, 12, 17).getTime();
		const compiled = compileYearView([item("span", start, end)], {
			anchor: NOW,
			weekStartsOn: 1,
			now: NOW,
		});
		const june = compiled.months[5];
		expect(june?.total).toBe(3); // 10th, 11th, 12th
	});

	it("flags today", () => {
		const compiled = compileYearView([], { anchor: NOW, weekStartsOn: 1, now: NOW });
		const may = compiled.months[4];
		const today = may?.days.find((d) => d.isToday);
		expect(today?.dayOfMonth).toBe(14);
	});
});
