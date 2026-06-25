// @vitest-environment jsdom
/**
 * KBN-S-pickers — the cover picker's tab row is a hook-stamped horizontal
 * tablist (←/→ move + activate). Verifies the role flows through
 * `useCompositeKeyboard` (no hand-written role="tablist"/role="tab" literal) and
 * arrow keys switch tabs. The virtual cover grid is untouched (and layout-
 * dependent — verified on perf CI).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverPicker } from "./picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

const COVERS = {
	uploadBytes: vi.fn(() => Promise.resolve({ url: "u", thumbUrl: "t" })),
	list: () => Promise.resolve([]),
};

describe("CoverPicker — KBN-S-pickers tablist keyboard", () => {
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
			root.render(
				<CoverPicker
					value={null}
					onChange={() => undefined}
					onClose={() => undefined}
					covers={COVERS}
				/>,
			);
		});
	}

	const tablist = () => host.querySelector<HTMLElement>(".icon-picker__tabs");
	const tabs = () => host.querySelectorAll<HTMLElement>('.icon-picker__tabs [role="tab"]');

	it("stamps the tablist role + horizontal orientation through the hook", () => {
		mount();
		expect(tablist()?.getAttribute("role")).toBe("tablist");
		expect(tablist()?.getAttribute("aria-orientation")).toBe("horizontal");
		// value=null → tabs [Image, Palette], Image active.
		expect(tabs()).toHaveLength(2);
		expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
	});

	it("ArrowRight switches the active tab", () => {
		mount();
		const ev = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
		act(() => {
			tablist()?.dispatchEvent(ev);
		});
		expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
	});
});
