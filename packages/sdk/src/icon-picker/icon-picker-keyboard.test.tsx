// @vitest-environment jsdom
/**
 * KBN-S-pickers — the SDK icon picker's tab row (horizontal tablist) and
 * skin-tone row (horizontal radiogroup, aria-checked) flow their roles through
 * `useCompositeKeyboard`; arrow keys switch tabs / tones. The emoji/icon virtual
 * grids are untouched (verified on perf CI).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IconPicker } from "./picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe("IconPicker (SDK) — KBN-S-pickers tablist + radiogroup keyboard", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	function mount(): void {
		act(() => {
			root.render(<IconPicker value={null} onChange={() => undefined} onClose={() => undefined} />);
		});
	}

	const tablist = () => host.querySelector<HTMLElement>(".icon-picker__tabs");
	const tabs = () => host.querySelectorAll<HTMLElement>('.icon-picker__tabs [role="tab"]');
	const radiogroup = () => host.querySelector<HTMLElement>(".icon-picker__skin-row");
	const radios = () => host.querySelectorAll<HTMLElement>('.icon-picker__skin-row [role="radio"]');
	const arrowRight = (el: Element | null) =>
		act(() => {
			el?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
			);
		});

	it("tab row is a hook-stamped tablist; ArrowRight switches tabs", () => {
		mount();
		expect(tablist()?.getAttribute("role")).toBe("tablist");
		expect(tablist()?.getAttribute("aria-orientation")).toBe("horizontal");
		expect(tabs()).toHaveLength(4);
		// value=null → Emoji tab active.
		expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
		arrowRight(tablist());
		expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("skin-tone row is a hook-stamped radiogroup (aria-checked); ArrowRight moves the checked tone", () => {
		mount();
		// Skin-tone row renders on the Emoji tab (the default).
		expect(radiogroup()?.getAttribute("role")).toBe("radiogroup");
		expect(radios().length).toBeGreaterThan(1);
		// ST.None is the first tone, checked initially; radios use aria-checked, not aria-selected.
		expect(radios()[0]?.getAttribute("aria-checked")).toBe("true");
		expect(radios()[0]?.hasAttribute("aria-selected")).toBe(false);
		arrowRight(radiogroup());
		expect(radios()[1]?.getAttribute("aria-checked")).toBe("true");
	});
});
