// @vitest-environment jsdom
/**
 * InlineEditInput — the resolve-exactly-once contract every scalar cell
 * relies on. Enter / blur commit; Escape reverts; and the trailing blur
 * that fires when the parent unmounts the input after Enter/Escape must
 * NOT re-fire onCommit (the bug this guard exists to kill: Escape used to
 * commit the draft through the unmount-blur instead of reverting).
 */

import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineEditInput } from "./inline-edit-input";

type Harness = { container: HTMLDivElement; root: Root; cleanup: () => void };

function mount(): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	return {
		container,
		root,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

function setValue(input: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function keydown(input: HTMLInputElement, key: string): void {
	input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("InlineEditInput", () => {
	let h: Harness;
	let onCommit: ReturnType<typeof vi.fn<(raw: string) => void>>;
	let onCancel: ReturnType<typeof vi.fn<() => void>>;

	beforeEach(() => {
		h = mount();
		onCommit = vi.fn<(raw: string) => void>();
		onCancel = vi.fn<() => void>();
	});
	afterEach(() => h.cleanup());

	function render(initialValue = "hi"): HTMLInputElement {
		act(() => {
			h.root.render(
				createElement(InlineEditInput, {
					initialValue,
					className: "bs-cell-input",
					ariaLabel: "Edit X",
					onCommit,
					onCancel,
				}),
			);
		});
		const input = h.container.querySelector("input");
		if (!input) throw new Error("no input rendered");
		return input;
	}

	it("focuses and selects the initial value on mount", () => {
		const input = render("hello");
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe("hello".length);
	});

	it("commits the typed draft once on Enter and ignores the trailing blur", () => {
		const input = render();
		act(() => setValue(input, "world"));
		act(() => keydown(input, "Enter"));
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("world");
		expect(onCancel).not.toHaveBeenCalled();

		act(() => input.blur());
		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it("commits the draft on blur", () => {
		const input = render();
		act(() => setValue(input, "abc"));
		act(() => input.blur());
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("abc");
	});

	it("reverts on Escape — never commits, even through the unmount blur", () => {
		const input = render();
		act(() => setValue(input, "changed"));
		act(() => keydown(input, "Escape"));
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onCommit).not.toHaveBeenCalled();

		act(() => input.blur());
		expect(onCommit).not.toHaveBeenCalled();
	});
});
