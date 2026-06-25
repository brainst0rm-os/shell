// @vitest-environment jsdom
/**
 * `attachCompositeKeyboard` — the DOM binding for the composite-keyboard
 * reducer (KBN-A DOM-imperative apps). Verifies ARIA stamping, roving focus,
 * activedescendant mode, arrow/Home/End navigation, Enter/Delete, typeahead,
 * the `disabled` skip, and listener teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCompositeKeyboard } from "./attach-composite-keyboard";
import { CompositeHost } from "./composite-host";
import { Orientation } from "./orientation";

let container: HTMLElement;
let cursor = 0;

function build(n: number): HTMLElement {
	const ul = document.createElement("ul");
	for (let i = 0; i < n; i++) {
		const li = document.createElement("li");
		li.dataset.compositeIndex = String(i);
		li.textContent = `row ${i}`;
		ul.append(li);
	}
	document.body.append(ul);
	return ul;
}

function press(key: string): void {
	container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
	cursor = 0;
	container = build(4);
});
afterEach(() => {
	document.body.innerHTML = "";
});

describe("attachCompositeKeyboard", () => {
	function attach(extra: Partial<Parameters<typeof attachCompositeKeyboard>[1]> = {}) {
		return attachCompositeKeyboard(container, {
			orientation: Orientation.Vertical,
			count: () => container.querySelectorAll("[data-composite-index]").length,
			activeIndex: () => cursor,
			onActiveIndexChange: (i) => {
				cursor = i;
			},
			...extra,
		});
	}

	it("stamps listbox + option roles, roving tabindex, and aria-selected", () => {
		attach();
		expect(container.getAttribute("role")).toBe("listbox");
		expect(container.getAttribute("aria-orientation")).toBe("vertical");
		const rows = [...container.querySelectorAll<HTMLElement>("[data-composite-index]")];
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(rows[0]?.tabIndex).toBe(0);
		expect(rows[1]?.tabIndex).toBe(-1);
		expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
	});

	it("ArrowDown advances the cursor + moves roving focus", () => {
		const onChange = vi.fn((i: number) => {
			cursor = i;
		});
		attach({ onActiveIndexChange: onChange });
		press("ArrowDown");
		expect(onChange).toHaveBeenCalledWith(1);
		expect(document.activeElement).toBe(container.querySelector('[data-composite-index="1"]'));
		expect(container.querySelector('[data-composite-index="1"]')?.getAttribute("aria-selected")).toBe(
			"true",
		);
	});

	it("End jumps to the last item, Home to the first", () => {
		attach();
		press("End");
		expect(cursor).toBe(3);
		press("Home");
		expect(cursor).toBe(0);
	});

	it("skips disabled indices", () => {
		attach({ disabled: () => new Set([1]) });
		press("ArrowDown");
		expect(cursor).toBe(2); // 1 is disabled → jump to 2
	});

	it("Enter fires onActivate with the active index", () => {
		const onActivate = vi.fn();
		cursor = 2;
		attach({ onActivate });
		press("Enter");
		expect(onActivate).toHaveBeenCalledWith(2);
	});

	it("Delete fires onDelete with the active index", () => {
		const onDelete = vi.fn();
		cursor = 1;
		attach({ onDelete });
		press("Delete");
		expect(onDelete).toHaveBeenCalledWith(1);
	});

	it("type-ahead jumps to the matching label", () => {
		const labels = ["apple", "banana", "cherry", "date"];
		attach({ typeahead: (i) => labels[i] ?? "" });
		press("c");
		expect(cursor).toBe(2);
	});

	it("activedescendant mode keeps focus on the container", () => {
		attach({ useAriaActiveDescendant: true });
		const rows = [...container.querySelectorAll<HTMLElement>("[data-composite-index]")];
		expect(rows[0]?.tabIndex).toBe(-1);
		expect(container.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		press("ArrowDown");
		expect(container.getAttribute("aria-activedescendant")).toBe(
			container.querySelector('[data-composite-index="1"]')?.id,
		);
		expect(document.activeElement).not.toBe(container.querySelector('[data-composite-index="1"]'));
	});

	it("combobox keyboardTarget: input drives the list + holds aria-activedescendant", () => {
		const input = document.createElement("input");
		input.type = "search";
		document.body.append(input);
		const onActivate = vi.fn();
		attachCompositeKeyboard(container, {
			orientation: Orientation.Vertical,
			host: CompositeHost.Combobox,
			useAriaActiveDescendant: true,
			keyboardTarget: input,
			count: () => container.querySelectorAll("[data-composite-index]").length,
			activeIndex: () => cursor,
			onActiveIndexChange: (i) => {
				cursor = i;
			},
			onActivate,
		});
		// aria-activedescendant lives on the input, not the listbox container.
		expect(container.getAttribute("role")).toBe("listbox");
		expect(input.getAttribute("aria-activedescendant")).toBe(
			container.querySelector('[data-composite-index="0"]')?.id,
		);
		expect(container.hasAttribute("aria-activedescendant")).toBe(false);
		// A keydown originating on the input drives the list.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(cursor).toBe(1);
		expect(input.getAttribute("aria-activedescendant")).toBe(
			container.querySelector('[data-composite-index="1"]')?.id,
		);
		// Focus stays on the input (activedescendant pattern — never roves onto rows).
		expect(document.activeElement).not.toBe(container.querySelector('[data-composite-index="1"]'));
		// Enter activates the cursor row.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onActivate).toHaveBeenCalledWith(1);
	});

	it("Orientation.Spatial navigates by {col,row} cells (nearest-in-direction)", () => {
		// A 2-column board: col 0 has rows 0,1; col 1 has rows 0,1.
		// Flat index order is column-major: 0=(0,0) 1=(0,1) 2=(1,0) 3=(1,1).
		const cells = [
			{ col: 0, row: 0 },
			{ col: 0, row: 1 },
			{ col: 1, row: 0 },
			{ col: 1, row: 1 },
		];
		attach({ orientation: Orientation.Spatial, cells: () => cells });
		// From (0,0): Down → (0,1) = index 1.
		press("ArrowDown");
		expect(cursor).toBe(1);
		// From (0,1): Right → (1,1) = index 3 (same row, next column).
		press("ArrowRight");
		expect(cursor).toBe(3);
		// From (1,1): Up → (1,0) = index 2.
		press("ArrowUp");
		expect(cursor).toBe(2);
		// From (1,0): Left → (0,0) = index 0.
		press("ArrowLeft");
		expect(cursor).toBe(0);
		// At the left edge, Left does not wrap.
		press("ArrowLeft");
		expect(cursor).toBe(0);
	});

	it("destroy() removes the keydown listener", () => {
		const onChange = vi.fn((i: number) => {
			cursor = i;
		});
		const handle = attach({ onActiveIndexChange: onChange });
		handle.destroy();
		press("ArrowDown");
		expect(onChange).not.toHaveBeenCalled();
	});
});
