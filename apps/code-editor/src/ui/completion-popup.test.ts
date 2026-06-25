/**
 * @vitest-environment jsdom
 *
 * Completion popup (9.7.3) — list rendering, the wrap-around selection
 * cursor, accept-on-click (focus-preserving), and show/hide lifecycle.
 * Pixel positioning is exercised by the pane integration test; here the
 * focus is the keyboard/selection model the pane drives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { type CompletionItem, CompletionKind } from "../logic/autocomplete";
import { type CompletionPopupHandle, createCompletionPopup } from "./completion-popup";

const ANCHOR = { left: 0, top: 0, bottom: 18 };

function item(label: string, kind = CompletionKind.Word): CompletionItem {
	return { label, insertText: label, kind };
}

let popup: CompletionPopupHandle | null = null;

afterEach(() => {
	popup?.dispose();
	popup = null;
	document.body.replaceChildren();
});

function mount(onAccept = vi.fn()) {
	const input = document.createElement("textarea");
	document.body.appendChild(input);
	popup = createCompletionPopup({ listLabel: "Completions", input, onAccept });
	document.body.appendChild(popup.element);
	return { popup, onAccept, input };
}

describe("createCompletionPopup", () => {
	it("renders an accessible listbox of items and opens on a non-empty list", () => {
		const { popup: p } = mount();
		p.show([item("foo"), item("bar", CompletionKind.Keyword)], ANCHOR);
		expect(p.isOpen).toBe(true);
		expect(p.element.getAttribute("role")).toBe("listbox");
		expect(p.element.getAttribute("aria-label")).toBe("Completions");
		const rows = p.element.querySelectorAll(".editor__completion-item");
		expect(rows.length).toBe(2);
		expect(rows[0]?.getAttribute("role")).toBe("option");
		expect(rows[0]?.querySelector(".editor__completion-label")?.textContent).toBe("foo");
		expect(rows[1]?.querySelector(".editor__completion-kind")?.getAttribute("data-kind")).toBe(
			CompletionKind.Keyword,
		);
		// First item selected by default.
		expect(p.selected()?.label).toBe("foo");
		expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
	});

	it("an empty list keeps the popup hidden", () => {
		const { popup: p, input } = mount();
		p.show([], ANCHOR);
		expect(p.isOpen).toBe(false);
		expect(p.element.hidden).toBe(true);
		expect(p.selected()).toBeNull();
		expect(input.getAttribute("aria-expanded")).toBe("false");
	});

	it("wires the combobox ARIA pattern onto the input", () => {
		const { popup: p, input } = mount();
		// Static wiring is set up front, before any show.
		expect(input.getAttribute("aria-autocomplete")).toBe("list");
		const listboxId = p.element.id;
		expect(listboxId).toBeTruthy();
		expect(input.getAttribute("aria-controls")).toBe(listboxId);
		expect(input.getAttribute("aria-expanded")).toBe("false");

		p.show([item("alpha"), item("beta")], ANCHOR);
		expect(input.getAttribute("aria-expanded")).toBe("true");
		// activedescendant points at the active option, whose id lives on the row.
		const active = input.getAttribute("aria-activedescendant");
		expect(active).toBe(`${listboxId}-opt-0`);
		expect(p.element.querySelector(`#${active}`)?.getAttribute("aria-selected")).toBe("true");

		p.move(1);
		expect(input.getAttribute("aria-activedescendant")).toBe(`${listboxId}-opt-1`);

		p.hide();
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(input.getAttribute("aria-activedescendant")).toBeNull();
	});

	it("distinct popups get distinct listbox ids", () => {
		const a = mount().popup;
		const inputB = document.createElement("textarea");
		const b = createCompletionPopup({ listLabel: "Completions", input: inputB, onAccept: vi.fn() });
		expect(a.element.id).not.toBe(b.element.id);
		b.dispose();
	});

	it("move wraps the selection in both directions", () => {
		const { popup: p } = mount();
		p.show([item("a"), item("b"), item("c")], ANCHOR);
		p.move(1);
		expect(p.selected()?.label).toBe("b");
		p.move(1);
		p.move(1);
		expect(p.selected()?.label, "wraps past the end back to the first").toBe("a");
		p.move(-1);
		expect(p.selected()?.label, "wraps before the start to the last").toBe("c");
	});

	it("clicking a row accepts it without stealing focus from the textarea", () => {
		const { popup: p, onAccept } = mount();
		p.show([item("alpha"), item("beta")], ANCHOR);
		const second = p.element.querySelectorAll<HTMLElement>(".editor__completion-item")[1];
		if (!second) throw new Error("row missing");
		// mousedown is prevented so focus stays put; click fires the accept.
		const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		second.dispatchEvent(mousedown);
		expect(mousedown.defaultPrevented).toBe(true);
		second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(onAccept).toHaveBeenCalledTimes(1);
		expect(onAccept.mock.calls[0]?.[0]).toMatchObject({ label: "beta" });
	});

	it("hide clears the rendered rows and resets selection", () => {
		const { popup: p } = mount();
		p.show([item("foo")], ANCHOR);
		p.hide();
		expect(p.isOpen).toBe(false);
		expect(p.element.hidden).toBe(true);
		expect(p.element.querySelectorAll(".editor__completion-item").length).toBe(0);
		expect(p.items).toEqual([]);
		expect(p.selected()).toBeNull();
		// move is inert while closed.
		p.move(1);
		expect(p.selected()).toBeNull();
	});
});
