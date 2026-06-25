/**
 * @vitest-environment jsdom
 *
 * Date pager — contract tests. Pure-DOM helper, jsdom is enough.
 */

import { describe, expect, it, vi } from "vitest";
import { createDatePager } from "./date-pager";

const labels = { today: "Today", prev: "Previous", next: "Next" };

describe("createDatePager", () => {
	it("renders three buttons in today → prev → next order", () => {
		const handle = createDatePager({
			labels,
			onToday: () => undefined,
			onPrev: () => undefined,
			onNext: () => undefined,
		});
		const buttons = handle.root.querySelectorAll("button");
		expect(buttons).toHaveLength(3);
		expect(buttons[0]).toBe(handle.today);
		expect(buttons[1]).toBe(handle.prev);
		expect(buttons[2]).toBe(handle.next);
		expect(handle.today.textContent).toBe("Today");
	});

	it("stamps aria-label + title on the arrow buttons (not the today button)", () => {
		const handle = createDatePager({
			labels,
			onToday: () => undefined,
			onPrev: () => undefined,
			onNext: () => undefined,
		});
		expect(handle.prev.getAttribute("aria-label")).toBe("Previous");
		expect(handle.prev.title).toBe("Previous");
		expect(handle.next.getAttribute("aria-label")).toBe("Next");
		expect(handle.next.title).toBe("Next");
		// Today carries its label as text, not aria-label.
		expect(handle.today.getAttribute("aria-label")).toBeNull();
	});

	it("invokes the correct callback per button (no cross-wiring)", () => {
		const onToday = vi.fn();
		const onPrev = vi.fn();
		const onNext = vi.fn();
		const handle = createDatePager({ labels, onToday, onPrev, onNext });

		handle.today.click();
		handle.prev.click();
		handle.next.click();

		expect(onToday).toHaveBeenCalledTimes(1);
		expect(onPrev).toHaveBeenCalledTimes(1);
		expect(onNext).toHaveBeenCalledTimes(1);
	});

	it("marks the arrow icons as inline-direction so RTL flips them", () => {
		const handle = createDatePager({
			labels,
			onToday: () => undefined,
			onPrev: () => undefined,
			onNext: () => undefined,
		});
		const prevSvg = handle.prev.querySelector("svg");
		const nextSvg = handle.next.querySelector("svg");
		expect(prevSvg?.getAttribute("data-icon-direction")).toBe("inline");
		expect(nextSvg?.getAttribute("data-icon-direction")).toBe("inline");
	});

	it("appends the host className to the root without losing the SDK class", () => {
		const handle = createDatePager({
			labels,
			onToday: () => undefined,
			onPrev: () => undefined,
			onNext: () => undefined,
			className: "cal-toolbar__nav",
		});
		expect(handle.root.className).toBe("bs-date-pager cal-toolbar__nav");
	});
});
