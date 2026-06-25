/**
 * @vitest-environment jsdom
 *
 * Vitest — `createMonthGrid` covers the contracts every consumer depends on:
 * - 42 cells (6×7) appear in the grid in chronological order.
 * - `--today` / `--other-month` / `--weekend` / `--selected` classes apply.
 * - The renderCell slot receives each cell + can append content.
 * - onDateClick / onEmptyCellClick fire with the matching cell payload.
 * - update() re-renders with the new focus month.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WeekStartsOn } from "../date-grid/date-grid";
import { MonthGridDensity, createMonthGrid } from "./month-grid";

const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const JAN_1_2026 = new Date(2026, 0, 1, 12, 0, 0, 0).getTime();
const FEB_15_2026 = new Date(2026, 1, 15, 12, 0, 0, 0).getTime();

function must<T>(v: T | null | undefined, msg: string): T {
	if (v == null) throw new Error(msg);
	return v;
}

let handles: Array<{ destroy(): void }> = [];

afterEach(() => {
	for (const h of handles) h.destroy();
	handles = [];
});

function mount(opts: Parameters<typeof createMonthGrid>[0]) {
	const h = createMonthGrid(opts);
	handles.push(h);
	return h;
}

describe("createMonthGrid", () => {
	it("renders 42 day cells in chronological order", () => {
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			weekStartsOn: WeekStartsOn.Sunday,
		});
		expect(grid.cells).toHaveLength(42);
		for (let i = 1; i < grid.cells.length; i += 1) {
			expect(must(grid.cells[i], `cells[${i}]`).dateEpochMs).toBeGreaterThan(
				must(grid.cells[i - 1], `cells[${i - 1}]`).dateEpochMs,
			);
		}
	});

	it("renders the weekday header by default and skips it when disabled", () => {
		const withHeader = mount({ focusMs: JAN_15_2026, todayMs: JAN_15_2026 });
		expect(withHeader.element.querySelector(".bs-cal-month__weekdays")).not.toBeNull();
		expect(withHeader.element.querySelectorAll(".bs-cal-month__weekday")).toHaveLength(7);

		const without = mount({ focusMs: JAN_15_2026, todayMs: JAN_15_2026, showWeekdays: false });
		expect(without.element.querySelector(".bs-cal-month__weekdays")).toBeNull();
	});

	it("applies today / other-month / weekend / selected classes", () => {
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			selectedMs: JAN_1_2026,
			weekStartsOn: WeekStartsOn.Sunday,
		});

		const today = must(
			grid.cells.find((c) => c.isToday),
			"today cell",
		);
		expect(today.element.classList.contains("bs-cal-month__cell--today")).toBe(true);

		const otherMonth = must(
			grid.cells.find((c) => !c.inMonth),
			"other-month cell",
		);
		expect(otherMonth.element.classList.contains("bs-cal-month__cell--other-month")).toBe(true);

		const weekend = must(
			grid.cells.find((c) => c.isWeekend),
			"weekend cell",
		);
		expect(weekend.element.classList.contains("bs-cal-month__cell--weekend")).toBe(true);

		const selected = must(
			grid.cells.find((c) => c.isSelected),
			"selected cell",
		);
		expect(selected.element.classList.contains("bs-cal-month__cell--selected")).toBe(true);
	});

	it("invokes renderCell for every cell with a fillable content slot", () => {
		const renderCell = vi.fn((cell: { contentSlot: HTMLElement; dayOfMonth: number }) => {
			const node = document.createElement("span");
			node.className = "test-chip";
			node.textContent = `${cell.dayOfMonth}`;
			cell.contentSlot.appendChild(node);
		});
		const grid = mount({ focusMs: JAN_15_2026, todayMs: JAN_15_2026, renderCell });
		expect(renderCell).toHaveBeenCalledTimes(42);
		expect(grid.element.querySelectorAll(".test-chip")).toHaveLength(42);
	});

	it("fires onDateClick with the matching cell and renders a button", () => {
		const onDateClick = vi.fn();
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onDateClick,
		});
		const cell = must(
			grid.cells.find((c) => c.dayOfMonth === 15 && c.inMonth),
			"day-15 cell",
		);
		expect(cell.dateElement.tagName).toBe("BUTTON");
		(cell.dateElement as HTMLButtonElement).click();
		expect(onDateClick).toHaveBeenCalledOnce();
		expect(must(onDateClick.mock.calls[0], "first call")[0].dateEpochMs).toBe(cell.dateEpochMs);
	});

	it("renders the date as a span when onDateClick is omitted", () => {
		const grid = mount({ focusMs: JAN_15_2026, todayMs: JAN_15_2026 });
		expect(must(grid.cells[0], "cells[0]").dateElement.tagName).toBe("SPAN");
	});

	it("fires onEmptyCellClick only when the target is outside a button", () => {
		const onEmptyCellClick = vi.fn();
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onDateClick: () => {},
			onEmptyCellClick,
		});
		const cell = must(
			grid.cells.find((c) => c.inMonth),
			"in-month cell",
		);
		(cell.dateElement as HTMLButtonElement).click();
		expect(onEmptyCellClick).not.toHaveBeenCalled();

		cell.contentSlot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onEmptyCellClick).toHaveBeenCalledOnce();
	});

	it("compact density adds the modifier class", () => {
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			density: MonthGridDensity.Compact,
		});
		expect(grid.element.classList.contains("bs-cal-month--compact")).toBe(true);
	});

	it("update() re-renders for a new focus month and refreshes selection", () => {
		const grid = mount({
			focusMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			selectedMs: JAN_1_2026,
		});
		const before = must(
			grid.cells.find((c) => c.inMonth && c.dayOfMonth === 15),
			"before day-15 cell",
		).dateEpochMs;
		grid.update({ focusMs: FEB_15_2026, selectedMs: FEB_15_2026 });
		const after = must(
			grid.cells.find((c) => c.inMonth && c.dayOfMonth === 15),
			"after day-15 cell",
		).dateEpochMs;
		expect(after).not.toBe(before);
		expect(grid.cells.some((c) => c.isSelected && c.dayOfMonth === 15)).toBe(true);
	});

	it("sets data-date-key on every cell so hosts can join by date", () => {
		const grid = mount({ focusMs: JAN_15_2026, todayMs: JAN_15_2026 });
		for (const cell of grid.cells) {
			expect(cell.element.dataset.dateKey).toBe(cell.dateKey);
			expect(cell.element.dataset.dateEpochMs).toBe(String(cell.dateEpochMs));
		}
	});
});
