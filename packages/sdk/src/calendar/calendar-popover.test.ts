/**
 * @vitest-environment jsdom
 *
 * Vitest — `openCalendarPopover` covers the anchored single-date picker:
 * - Mounts a `.bs-cal-popover` dialog hosting a `.bs-cal-mini`.
 * - Picking a day fires onSelect with the epoch-ms AND closes the popover.
 * - Escape / outside-mousedown close it; opening again replaces the prior.
 * - renderCell decorates day cells (entry-presence dots).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCalendarPopover, openCalendarPopover } from "./calendar-popover";

const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const LABELS = { today: "Today", prev: "Previous", next: "Next" };

afterEach(() => {
	closeCalendarPopover();
});

function panel(): HTMLElement | null {
	return document.querySelector<HTMLElement>(".bs-cal-popover");
}

describe("openCalendarPopover", () => {
	it("mounts a labelled dialog hosting the mini-calendar", () => {
		openCalendarPopover({
			anchor: { x: 10, y: 10 },
			ariaLabel: "Go to date",
			labels: LABELS,
			valueMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onSelect: () => {},
		});
		const el = panel();
		expect(el).not.toBeNull();
		expect(el?.getAttribute("role")).toBe("dialog");
		expect(el?.getAttribute("aria-label")).toBe("Go to date");
		expect(el?.querySelector(".bs-cal-mini")).not.toBeNull();
	});

	it("fires onSelect with the picked day and closes", () => {
		const onSelect = vi.fn();
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "Go to date",
			labels: LABELS,
			valueMs: JAN_15_2026,
			todayMs: JAN_15_2026,
			onSelect,
		});
		const day = panel()?.querySelector<HTMLButtonElement>(".bs-cal-month__date");
		day?.click();
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(typeof onSelect.mock.calls[0]?.[0]).toBe("number");
		expect(panel()).toBeNull();
	});

	it("closes on Escape", () => {
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "Go to date",
			labels: LABELS,
			todayMs: JAN_15_2026,
			onSelect: () => {},
		});
		expect(panel()).not.toBeNull();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(panel()).toBeNull();
	});

	it("closes on outside mousedown but stays open for inside clicks", () => {
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "Go to date",
			labels: LABELS,
			todayMs: JAN_15_2026,
			onSelect: () => {},
		});
		panel()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(panel()).not.toBeNull();
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(panel()).toBeNull();
	});

	it("replaces a prior open popover (one at a time)", () => {
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "First",
			labels: LABELS,
			todayMs: JAN_15_2026,
			onSelect: () => {},
		});
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "Second",
			labels: LABELS,
			todayMs: JAN_15_2026,
			onSelect: () => {},
		});
		const els = document.querySelectorAll(".bs-cal-popover");
		expect(els.length).toBe(1);
		expect(els[0]?.getAttribute("aria-label")).toBe("Second");
	});

	it("runs renderCell for day cells", () => {
		const renderCell = vi.fn();
		openCalendarPopover({
			anchor: { x: 0, y: 0 },
			ariaLabel: "Go to date",
			labels: LABELS,
			todayMs: JAN_15_2026,
			renderCell,
			onSelect: () => {},
		});
		expect(renderCell).toHaveBeenCalled();
	});
});
