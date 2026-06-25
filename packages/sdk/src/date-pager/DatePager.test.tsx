// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePager } from "./DatePager";

const labels = { today: "Today", prev: "Previous", next: "Next" };

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

function buttons(): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll("button"));
}

describe("<DatePager>", () => {
	it("renders three buttons in today → prev → next order with the SDK class", () => {
		act(() => {
			root.render(<DatePager labels={labels} onToday={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
		});
		const root_ = container.querySelector(".bs-date-pager");
		expect(root_).not.toBeNull();
		const bs = buttons();
		expect(bs).toHaveLength(3);
		expect(bs[0]?.className).toBe("bs-date-pager__today");
		expect(bs[0]?.textContent).toBe("Today");
		expect(bs[1]?.className).toBe("bs-date-pager__arrow bs-date-pager__arrow--prev");
		expect(bs[2]?.className).toBe("bs-date-pager__arrow bs-date-pager__arrow--next");
	});

	it("stamps aria-label + title on the arrows, not the today button", () => {
		act(() => {
			root.render(<DatePager labels={labels} onToday={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
		});
		const [today, prev, next] = buttons();
		expect(prev?.getAttribute("aria-label")).toBe("Previous");
		expect(prev?.dataset.bsTooltip).toBe("Previous");
		expect(next?.getAttribute("aria-label")).toBe("Next");
		expect(today?.getAttribute("aria-label")).toBeNull();
	});

	it("invokes the correct callback per button (no cross-wiring)", () => {
		const onToday = vi.fn();
		const onPrev = vi.fn();
		const onNext = vi.fn();
		act(() => {
			root.render(<DatePager labels={labels} onToday={onToday} onPrev={onPrev} onNext={onNext} />);
		});
		const [today, prev, next] = buttons();
		act(() => today?.click());
		act(() => prev?.click());
		act(() => next?.click());
		expect(onToday).toHaveBeenCalledTimes(1);
		expect(onPrev).toHaveBeenCalledTimes(1);
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("marks the arrow icons as inline-direction so RTL flips them", () => {
		act(() => {
			root.render(<DatePager labels={labels} onToday={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
		});
		const [, prev, next] = buttons();
		expect(prev?.querySelector("svg")?.getAttribute("data-icon-direction")).toBe("inline");
		expect(next?.querySelector("svg")?.getAttribute("data-icon-direction")).toBe("inline");
	});

	it("appends the host className without losing the SDK class", () => {
		act(() => {
			root.render(
				<DatePager
					labels={labels}
					onToday={vi.fn()}
					onPrev={vi.fn()}
					onNext={vi.fn()}
					className="cal-toolbar__nav"
				/>,
			);
		});
		const el = container.querySelector(".bs-date-pager");
		expect(el?.className).toBe("bs-date-pager cal-toolbar__nav");
	});
});
