// @vitest-environment jsdom
/**
 * KBN — the shared `<Segmented>` primitive is a horizontal radiogroup driven by
 * `useCompositeKeyboard`: ←/→/Home/End move + select (selection follows focus),
 * `aria-checked` marks the active option, roles flow through the hook.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Bravo" },
	{ value: "c", label: "Charlie" },
] as const;

describe("Segmented — KBN radiogroup keyboard", () => {
	let host: HTMLDivElement;
	let root: Root;
	let onChange: Mock<(v: string) => void>;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		onChange = vi.fn<(v: string) => void>();
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	function mount(value: string): void {
		act(() => {
			root.render(<Segmented value={value} onChange={onChange} options={OPTIONS} aria-label="Pick" />);
		});
	}

	const group = () => host.querySelector<HTMLElement>(".segmented");
	const radios = () => host.querySelectorAll<HTMLElement>('.segmented [role="radio"]');

	it("is a hook-stamped horizontal radiogroup with aria-checked on the active option", () => {
		mount("a");
		expect(group()?.getAttribute("role")).toBe("radiogroup");
		expect(group()?.getAttribute("aria-orientation")).toBe("horizontal");
		expect(group()?.getAttribute("aria-label")).toBe("Pick");
		expect(radios()).toHaveLength(3);
		expect(radios()[0]?.getAttribute("aria-checked")).toBe("true");
		// radios use aria-checked, never aria-selected.
		expect(radios()[0]?.hasAttribute("aria-selected")).toBe(false);
		// Roving tabindex: only the active option is in the Tab order.
		expect(radios()[0]?.tabIndex).toBe(0);
		expect(radios()[1]?.tabIndex).toBe(-1);
	});

	it("ArrowRight selects the next option (selection follows focus)", () => {
		mount("a");
		act(() => {
			group()?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
			);
		});
		expect(onChange).toHaveBeenCalledWith("b");
	});

	it("click still selects", () => {
		mount("a");
		act(() => radios()[2]?.click());
		expect(onChange).toHaveBeenCalledWith("c");
	});
});
