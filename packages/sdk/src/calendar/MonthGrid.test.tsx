// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekStartsOn } from "../date-grid/date-grid";
import { MonthGrid } from "./MonthGrid";
import { MonthGridDensity } from "./month-grid";

const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const JAN_1_2026 = new Date(2026, 0, 1, 12, 0, 0, 0).getTime();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function cells(): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(".bs-cal-month__cell"));
}

describe("<MonthGrid>", () => {
	it("renders 42 day cells in chronological order with date attrs", () => {
		act(() => {
			root.render(
				<MonthGrid focusMs={JAN_15_2026} todayMs={JAN_15_2026} weekStartsOn={WeekStartsOn.Sunday} />,
			);
		});
		const c = cells();
		expect(c).toHaveLength(42);
		let prev = -1;
		for (const cell of c) {
			const ms = Number(cell.dataset.dateEpochMs);
			expect(cell.dataset.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(ms).toBeGreaterThan(prev);
			prev = ms;
		}
	});

	it("renders the weekday header by default and skips it when disabled", () => {
		act(() => {
			root.render(<MonthGrid focusMs={JAN_15_2026} todayMs={JAN_15_2026} />);
		});
		expect(container.querySelector(".bs-cal-month__weekdays")).not.toBeNull();
		expect(container.querySelectorAll(".bs-cal-month__weekday")).toHaveLength(7);

		act(() => {
			root.render(<MonthGrid focusMs={JAN_15_2026} todayMs={JAN_15_2026} showWeekdays={false} />);
		});
		expect(container.querySelector(".bs-cal-month__weekdays")).toBeNull();
	});

	it("applies today / other-month / weekend / selected state classes", () => {
		act(() => {
			root.render(
				<MonthGrid
					focusMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					selectedMs={JAN_1_2026}
					weekStartsOn={WeekStartsOn.Sunday}
				/>,
			);
		});
		expect(container.querySelectorAll(".bs-cal-month__cell--today")).toHaveLength(1);
		expect(container.querySelector(".bs-cal-month__cell--selected")).not.toBeNull();
		expect(container.querySelectorAll(".bs-cal-month__cell--other-month").length).toBeGreaterThan(0);
		expect(container.querySelectorAll(".bs-cal-month__cell--weekend").length).toBeGreaterThan(0);
	});

	it("renders the renderCell content node into each cell's content slot", () => {
		act(() => {
			root.render(
				<MonthGrid
					focusMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					renderCell={(cell) => <span className="dot">{cell.dayOfMonth}</span>}
				/>,
			);
		});
		const slots = container.querySelectorAll(".bs-cal-month__content .dot");
		expect(slots).toHaveLength(42);
	});

	it("hands renderCell a row-major ordinal index 0..41", () => {
		act(() => {
			root.render(
				<MonthGrid
					focusMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					renderCell={(cell) => <span className="idx">{cell.index}</span>}
				/>,
			);
		});
		const indices = Array.from(container.querySelectorAll(".idx"), (el) => Number(el.textContent));
		expect(indices).toEqual(Array.from({ length: 42 }, (_, i) => i));
	});

	it("renders the date as a <button> only when onDateClick is provided and fires it", () => {
		act(() => {
			root.render(<MonthGrid focusMs={JAN_15_2026} todayMs={JAN_15_2026} />);
		});
		expect(container.querySelector("button.bs-cal-month__date")).toBeNull();
		expect(container.querySelector("span.bs-cal-month__date")).not.toBeNull();

		const onDateClick = vi.fn();
		act(() => {
			root.render(<MonthGrid focusMs={JAN_15_2026} todayMs={JAN_15_2026} onDateClick={onDateClick} />);
		});
		const btn = container.querySelector<HTMLButtonElement>("button.bs-cal-month__date");
		expect(btn).not.toBeNull();
		act(() => btn?.click());
		expect(onDateClick).toHaveBeenCalledTimes(1);
		expect(onDateClick.mock.calls[0]?.[0]).toMatchObject({ dayOfMonth: expect.any(Number) });
	});

	it("fires onEmptyCellClick from cell space but not from the date button", () => {
		const onEmptyCellClick = vi.fn();
		const onDateClick = vi.fn();
		act(() => {
			root.render(
				<MonthGrid
					focusMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					onDateClick={onDateClick}
					onEmptyCellClick={onEmptyCellClick}
				/>,
			);
		});
		const firstCell = cells()[0];
		const content = firstCell?.querySelector<HTMLElement>(".bs-cal-month__content");
		act(() => content?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		expect(onEmptyCellClick).toHaveBeenCalledTimes(1);

		const btn = firstCell?.querySelector<HTMLButtonElement>("button.bs-cal-month__date");
		act(() => btn?.click());
		// Clicking the date button must not also trigger the empty-cell handler.
		expect(onEmptyCellClick).toHaveBeenCalledTimes(1);
		expect(onDateClick).toHaveBeenCalledTimes(1);
	});

	it("adds the compact density modifier + extra className to the root", () => {
		act(() => {
			root.render(
				<MonthGrid
					focusMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					density={MonthGridDensity.Compact}
					className="my-cal"
				/>,
			);
		});
		const rootEl = container.querySelector(".bs-cal-month");
		expect(rootEl?.className).toBe("bs-cal-month bs-cal-month--compact my-cal");
	});
});
