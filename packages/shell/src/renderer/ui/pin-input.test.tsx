// @vitest-environment jsdom
/**
 * `<PinInput>` — segmented PIN entry behaviour: digit auto-advance, the
 * left-packed value contract (no gaps), backspace-to-previous, paste-fill,
 * non-digit rejection, and `onComplete` on the final box.
 */

import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinInput } from "./pin-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
	const [value, setValue] = useState("");
	return (
		<>
			<PinInput value={value} onChange={setValue} onComplete={onComplete} ariaLabel="PIN" />
			<output data-testid="value">{value}</output>
		</>
	);
}

describe("PinInput", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const boxes = () => [...host.querySelectorAll(".pin-input__box")] as HTMLInputElement[];
	const box = (i: number) => {
		const el = boxes()[i];
		if (!el) throw new Error(`no box ${i}`);
		return el;
	};
	const value = () => host.querySelector('[data-testid="value"]')?.textContent ?? "";
	const typeInto = (box: HTMLInputElement, char: string) => {
		act(() => {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
			setter?.call(box, char);
			box.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	const keyDown = (box: HTMLInputElement, key: string) => {
		act(() =>
			box.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
		);
	};

	const mount = (onComplete: (v: string) => void = () => {}) =>
		act(() => root.render(<Harness onComplete={onComplete} />));

	it("renders `length` boxes (default 6)", () => {
		mount();
		expect(boxes()).toHaveLength(6);
	});

	it("fills boxes left-to-right and reports the value", () => {
		mount();
		typeInto(box(0), "1");
		typeInto(box(1), "2");
		typeInto(box(2), "3");
		expect(value()).toBe("123");
	});

	it("ignores non-digit input", () => {
		mount();
		typeInto(box(0), "a");
		expect(value()).toBe("");
	});

	it("calls onComplete when the last box is filled", () => {
		const onComplete = vi.fn();
		mount(onComplete);
		typeInto(box(0), "1");
		typeInto(box(1), "2");
		typeInto(box(2), "3");
		typeInto(box(3), "4");
		typeInto(box(4), "5");
		expect(onComplete).not.toHaveBeenCalled();
		typeInto(box(5), "6");
		expect(value()).toBe("123456");
		expect(onComplete).toHaveBeenCalledWith("123456");
	});

	it("backspace on an empty box deletes the previous digit", () => {
		mount();
		typeInto(box(0), "1");
		typeInto(box(1), "2");
		// Focus the (empty) third box and backspace → removes the 2.
		keyDown(box(2), "Backspace");
		expect(value()).toBe("1");
	});

	it("paste fills from the clipboard digits", () => {
		mount();
		act(() => {
			const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
				clipboardData: { getData: () => string };
			};
			e.clipboardData = { getData: () => "5678" };
			box(0).dispatchEvent(e);
		});
		expect(value()).toBe("5678");
	});
});
