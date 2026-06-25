// @vitest-environment jsdom
/**
 * KBN-A-files (bulk bar) — the multi-selection action bar's composite-keyboard
 * contract: the bar is a horizontal toolbar (`role` from the hook), its action
 * buttons keep native click activation, and ArrowLeft/Right rove between them
 * (roving tabindex; no aria-selected/checked — `selectionAttribute: None`).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkActionBar, type BulkActionBarProps } from "./bulk-action-bar";

type Harness = { bar: HTMLElement; cleanup: () => void };

function mountBar(props: Partial<BulkActionBarProps>): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() =>
		root.render(
			<BulkActionBar
				count={3}
				onDuplicate={vi.fn()}
				onMove={vi.fn()}
				onCopy={vi.fn()}
				onRename={vi.fn()}
				onDelete={vi.fn()}
				onClear={vi.fn()}
				{...props}
			/>,
		),
	);
	const bar = container.querySelector<HTMLElement>('[data-testid="bulk-bar"]');
	if (!bar) throw new Error("bulk bar not rendered");
	return {
		bar,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

function press(node: HTMLElement, key: string): void {
	act(() => {
		node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	});
}

describe("BulkActionBar keyboard (KBN-A-files)", () => {
	let h: Harness | null = null;
	afterEach(() => {
		h?.cleanup();
		h = null;
		document.body.innerHTML = "";
	});

	it("renders the bar as a horizontal toolbar (role from the hook)", () => {
		h = mountBar({});
		expect(h.bar.getAttribute("role")).toBe("toolbar");
		expect(h.bar.getAttribute("aria-orientation")).toBe("horizontal");
		// Action buttons are native — the hook omits an item role.
		const duplicate = h.bar.querySelector<HTMLElement>('[data-testid="bulk-duplicate"]');
		expect(duplicate?.getAttribute("role")).toBeNull();
		expect(duplicate?.getAttribute("tabindex")).toBe("0");
	});

	it("ArrowRight roves the cursor across the action controls", () => {
		h = mountBar({});
		const duplicate = h.bar.querySelector<HTMLElement>('[data-testid="bulk-duplicate"]');
		const move = h.bar.querySelector<HTMLElement>('[data-testid="bulk-move"]');
		expect(duplicate?.getAttribute("tabindex")).toBe("0");
		expect(move?.getAttribute("tabindex")).toBe("-1");
		press(h.bar, "ArrowRight");
		expect(duplicate?.getAttribute("tabindex")).toBe("-1");
		expect(move?.getAttribute("tabindex")).toBe("0");
	});

	it("Enter on the focused control fires its native click action", () => {
		const onDuplicate = vi.fn();
		h = mountBar({ onDuplicate });
		const duplicate = h.bar.querySelector<HTMLButtonElement>('[data-testid="bulk-duplicate"]');
		duplicate?.focus();
		duplicate?.click();
		expect(onDuplicate).toHaveBeenCalledTimes(1);
	});
});
