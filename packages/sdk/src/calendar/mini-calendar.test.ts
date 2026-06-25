/**
 * @vitest-environment jsdom
 *
 * Vitest — `createMiniCalendar` covers the date-picker contract:
 * - Renders header + 42-cell grid.
 * - onSelect fires with the clicked epoch-ms; the cell becomes selected.
 * - prev/next nav steps the view by ±1 month and fires onViewChange.
 * - setValue + setView re-render correctly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createMiniCalendar } from "./mini-calendar";

const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();

function must<T>(v: T | null | undefined, msg: string): T {
	if (v == null) throw new Error(msg);
	return v;
}

let handles: Array<{ destroy(): void }> = [];

afterEach(() => {
	for (const h of handles) h.destroy();
	handles = [];
});

function mount(opts: Parameters<typeof createMiniCalendar>[0]) {
	const h = createMiniCalendar(opts);
	handles.push(h);
	return h;
}

describe("createMiniCalendar", () => {
	it("renders a header with title and 42-cell grid", () => {
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			valueMs: JAN_15_2026,
			todayMs: JAN_15_2026,
		});
		expect(mini.element.querySelector(".bs-cal-mini__title")?.textContent).toMatch(/January/i);
		expect(mini.element.querySelectorAll(".bs-cal-month__cell")).toHaveLength(42);
	});

	it("hides the header when showHeader is false", () => {
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			valueMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			showHeader: false,
		});
		expect(mini.element.querySelector(".bs-cal-mini__header")).toBeNull();
	});

	it("fires onSelect with the clicked date and updates selection", () => {
		const onSelect = vi.fn();
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			valueMs: null,
			viewMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onSelect,
		});
		const buttons = mini.element.querySelectorAll<HTMLButtonElement>("button.bs-cal-month__date");
		const target = must(buttons[10], "buttons[10]");
		target.click();
		expect(onSelect).toHaveBeenCalledOnce();
		const firstCall = must(onSelect.mock.calls[0], "first onSelect call");
		expect(typeof firstCall[0]).toBe("number");
		expect(mini.valueMs).toBe(firstCall[0]);
	});

	it("steps the view by ±1 month on prev / next clicks", () => {
		const onViewChange = vi.fn();
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			viewMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onViewChange,
		});
		const prev = must(
			mini.element.querySelector<HTMLButtonElement>(".bs-date-pager__arrow--prev"),
			"prev nav button",
		);
		const next = must(
			mini.element.querySelector<HTMLButtonElement>(".bs-date-pager__arrow--next"),
			"next nav button",
		);

		next.click();
		expect(onViewChange).toHaveBeenCalledTimes(1);
		expect(new Date(mini.viewMs).getMonth()).toBe(1);

		prev.click();
		expect(new Date(mini.viewMs).getMonth()).toBe(0);
	});

	it("jumps to today's month and selects it on the today button", () => {
		const onSelect = vi.fn();
		const onViewChange = vi.fn();
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			viewMs: new Date(2026, 5, 1, 12, 0, 0, 0).getTime(),
			todayMs: JAN_15_2026,
			onSelect,
			onViewChange,
		});
		const today = must(
			mini.element.querySelector<HTMLButtonElement>(".bs-date-pager__today"),
			"today button",
		);
		today.click();
		expect(onViewChange).toHaveBeenCalledWith(JAN_15_2026);
		expect(onSelect).toHaveBeenCalledWith(JAN_15_2026);
		expect(mini.valueMs).toBe(JAN_15_2026);
		expect(mini.element.querySelector(".bs-cal-mini__title")?.textContent).toMatch(/January/i);
	});

	it("setView updates the title + grid", () => {
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			viewMs: JAN_15_2026,
			todayMs: JAN_15_2026,
		});
		mini.setView(new Date(2026, 5, 1, 12, 0, 0, 0).getTime());
		expect(mini.element.querySelector(".bs-cal-mini__title")?.textContent).toMatch(/June/i);
	});

	it("setValue updates the highlighted cell", () => {
		const mini = mount({
			labels: { today: "Today", prev: "Previous", next: "Next" },
			viewMs: JAN_15_2026,
			todayMs: JAN_15_2026,
		});
		mini.setValue(new Date(2026, 0, 20, 12, 0, 0, 0).getTime());
		const selected = mini.element.querySelector(".bs-cal-month__cell--selected");
		expect(selected).not.toBeNull();
		expect(selected?.querySelector(".bs-cal-month__date")?.textContent).toBe("20");
	});
});
