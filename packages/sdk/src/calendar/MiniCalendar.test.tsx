// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiniCalendar } from "./MiniCalendar";

const labels = { today: "Today", prev: "Previous", next: "Next" };
const JAN_15_2026 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const FEB_15_2026 = new Date(2026, 1, 15, 12, 0, 0, 0).getTime();

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

function title(): string | null {
	return container.querySelector(".bs-cal-mini__title")?.textContent ?? null;
}

describe("<MiniCalendar>", () => {
	it("renders the header (pager + title) and a compact month grid body", () => {
		act(() => {
			root.render(<MiniCalendar labels={labels} valueMs={JAN_15_2026} todayMs={JAN_15_2026} />);
		});
		expect(container.querySelector(".bs-cal-mini")).not.toBeNull();
		expect(container.querySelector(".bs-cal-mini__header .bs-date-pager")).not.toBeNull();
		expect(container.querySelector(".bs-cal-mini__title")).not.toBeNull();
		expect(container.querySelector(".bs-cal-mini__body .bs-cal-month--compact")).not.toBeNull();
		expect(container.querySelectorAll(".bs-cal-month__cell")).toHaveLength(42);
	});

	it("omits the header when showHeader=false", () => {
		act(() => {
			root.render(<MiniCalendar labels={labels} valueMs={JAN_15_2026} showHeader={false} />);
		});
		expect(container.querySelector(".bs-cal-mini__header")).toBeNull();
	});

	it("uses formatTitle override when provided", () => {
		act(() => {
			root.render(<MiniCalendar labels={labels} viewMs={JAN_15_2026} formatTitle={() => "CUSTOM"} />);
		});
		expect(title()).toBe("CUSTOM");
	});

	it("calls onChange when a day is clicked (controlled value)", () => {
		const onChange = vi.fn();
		act(() => {
			root.render(
				<MiniCalendar
					labels={labels}
					valueMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					onChange={onChange}
				/>,
			);
		});
		const dateBtn = container.querySelector<HTMLButtonElement>("button.bs-cal-month__date");
		act(() => dateBtn?.click());
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(typeof onChange.mock.calls[0]?.[0]).toBe("number");
	});

	it("steps the month internally (uncontrolled view) on prev/next and fires onViewChange", () => {
		const onViewChange = vi.fn();
		act(() => {
			root.render(
				<MiniCalendar
					labels={labels}
					valueMs={JAN_15_2026}
					todayMs={JAN_15_2026}
					formatTitle={(ms) => String(new Date(ms).getMonth())}
					onViewChange={onViewChange}
				/>,
			);
		});
		expect(title()).toBe("0"); // January
		const next = container.querySelector<HTMLButtonElement>(".bs-date-pager__arrow--next");
		act(() => next?.click());
		expect(title()).toBe("1"); // February
		expect(onViewChange).toHaveBeenCalledTimes(1);
	});

	it("respects a controlled viewMs prop (does not self-advance)", () => {
		const onViewChange = vi.fn();
		act(() => {
			root.render(
				<MiniCalendar
					labels={labels}
					viewMs={JAN_15_2026}
					formatTitle={(ms) => String(new Date(ms).getMonth())}
					onViewChange={onViewChange}
				/>,
			);
		});
		expect(title()).toBe("0");
		const next = container.querySelector<HTMLButtonElement>(".bs-date-pager__arrow--next");
		act(() => next?.click());
		// Controlled: title stays put until the host updates viewMs; only the
		// callback fired (with the requested next month).
		expect(title()).toBe("0");
		expect(onViewChange).toHaveBeenCalledTimes(1);
		expect(new Date(onViewChange.mock.calls[0]?.[0] as number).getMonth()).toBe(1);
	});

	it("Today fires both onChange and onViewChange", () => {
		const onChange = vi.fn();
		const onViewChange = vi.fn();
		act(() => {
			root.render(
				<MiniCalendar
					labels={labels}
					valueMs={FEB_15_2026}
					todayMs={JAN_15_2026}
					onChange={onChange}
					onViewChange={onViewChange}
				/>,
			);
		});
		const today = container.querySelector<HTMLButtonElement>(".bs-date-pager__today");
		act(() => today?.click());
		expect(onChange).toHaveBeenCalledWith(JAN_15_2026);
		expect(onViewChange).toHaveBeenCalledWith(JAN_15_2026);
	});

	it("renders the title as a button and calls onTitleClick with the shown month", () => {
		const onTitleClick = vi.fn();
		act(() => {
			root.render(<MiniCalendar labels={labels} viewMs={JAN_15_2026} onTitleClick={onTitleClick} />);
		});
		const titleBtn = container.querySelector<HTMLButtonElement>(".bs-cal-mini__title--button");
		expect(titleBtn).not.toBeNull();
		act(() => titleBtn?.click());
		expect(onTitleClick).toHaveBeenCalledTimes(1);
		expect(new Date(onTitleClick.mock.calls[0]?.[0] as number).getMonth()).toBe(0);
		expect(onTitleClick.mock.calls[0]?.[1]).toBe(titleBtn);
	});

	it("renders a plain (non-button) title when onTitleClick is absent", () => {
		act(() => {
			root.render(<MiniCalendar labels={labels} viewMs={JAN_15_2026} />);
		});
		expect(container.querySelector(".bs-cal-mini__title--button")).toBeNull();
		expect(container.querySelector(".bs-cal-mini__title")).not.toBeNull();
	});

	it("renders the per-cell content node via renderCell", () => {
		act(() => {
			root.render(
				<MiniCalendar
					labels={labels}
					valueMs={JAN_15_2026}
					renderCell={() => <i className="presence" />}
				/>,
			);
		});
		expect(container.querySelectorAll(".bs-cal-month__content .presence")).toHaveLength(42);
	});
});
