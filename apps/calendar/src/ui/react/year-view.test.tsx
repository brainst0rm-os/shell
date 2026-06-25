// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileYearView } from "../../logic/compile-view";
import { EVENT_SOURCE_KEY, type ScheduledItem } from "../../logic/scheduled-item";
import { renderInto } from "../../test/render";
import { WeekStartsOn } from "../../types/calendar-view";
import type { ViewCallbacks } from "./view-callbacks";
import { YearView } from "./year-view";

function item(id: string, start: number): ScheduledItem {
	return {
		id,
		sourceKey: EVENT_SOURCE_KEY,
		sourceEntityId: id,
		title: id,
		icon: null,
		start,
		end: null,
		allDay: false,
		location: null,
		recurrence: null,
		colorHint: null,
	};
}

const NOW = new Date(2026, 4, 14, 12, 0, 0).getTime();

function cbs(over: Partial<ViewCallbacks> = {}): Pick<ViewCallbacks, "onDayClick" | "onMonthOpen"> {
	return { onDayClick: vi.fn(), onMonthOpen: vi.fn(), ...over };
}

let handle: Awaited<ReturnType<typeof renderInto>> | null = null;
afterEach(async () => {
	await handle?.unmount();
	handle = null;
});

describe("YearView", () => {
	it("renders 12 mini-months", async () => {
		const compiled = compileYearView([], {
			anchor: NOW,
			weekStartsOn: WeekStartsOn.Monday,
			now: NOW,
		});
		handle = await renderInto(
			<YearView compiled={compiled} weekStartsOn={WeekStartsOn.Monday} callbacks={cbs()} />,
		);
		expect(handle.container.querySelectorAll(".cal-year__month")).toHaveLength(12);
	});

	it("clicking a month header opens that month; clicking a day opens the day", async () => {
		const may1 = new Date(2026, 4, 1, 9).getTime();
		const compiled = compileYearView([item("a", may1)], {
			anchor: NOW,
			weekStartsOn: WeekStartsOn.Monday,
			now: NOW,
		});
		const onMonthOpen = vi.fn();
		const onDayClick = vi.fn();
		handle = await renderInto(
			<YearView
				compiled={compiled}
				weekStartsOn={WeekStartsOn.Monday}
				callbacks={cbs({ onMonthOpen, onDayClick })}
			/>,
		);
		handle.container.querySelectorAll<HTMLButtonElement>(".cal-year__month-head")[4]?.click();
		expect(onMonthOpen).toHaveBeenCalledWith(compiled.months[4]?.monthStart);
		handle.container.querySelector<HTMLButtonElement>(".cal-year__day")?.click();
		expect(onDayClick).toHaveBeenCalled();
	});

	it("paints a density bucket on busy days", async () => {
		const may1 = new Date(2026, 4, 1, 9).getTime();
		const compiled = compileYearView([item("a", may1), item("b", may1), item("c", may1)], {
			anchor: NOW,
			weekStartsOn: WeekStartsOn.Monday,
			now: NOW,
		});
		handle = await renderInto(
			<YearView compiled={compiled} weekStartsOn={WeekStartsOn.Monday} callbacks={cbs()} />,
		);
		expect(handle.container.querySelector('.cal-year__day[data-density="2"]')).not.toBeNull();
	});
});
