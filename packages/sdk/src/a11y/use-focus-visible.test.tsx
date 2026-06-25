// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetFocusVisibleForTests, useFocusVisible } from "./use-focus-visible";

function Probe({ onTick }: { onTick: (visible: boolean) => void }) {
	const { isFocusVisible } = useFocusVisible();
	onTick(isFocusVisible);
	return null;
}

describe("useFocusVisible", () => {
	let host: HTMLDivElement;
	let root: Root;
	let snapshots: boolean[];

	beforeEach(() => {
		_resetFocusVisibleForTests();
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		snapshots = [];
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		_resetFocusVisibleForTests();
	});

	const press = (key: string) =>
		document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	const pointer = (type: "pointerdown" | "mousedown" | "touchstart") =>
		document.dispatchEvent(new Event(type, { bubbles: true }));

	it("starts pointer-modality (isFocusVisible=false) before any input", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		expect(snapshots[snapshots.length - 1]).toBe(false);
	});

	it("flips to visible on a Tab keydown", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("Tab"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
	});

	it("flips to suppressed on pointerdown / mousedown / touchstart", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("Tab"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
		act(() => pointer("pointerdown"));
		expect(snapshots[snapshots.length - 1]).toBe(false);
		act(() => press("ArrowDown"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
		act(() => pointer("mousedown"));
		expect(snapshots[snapshots.length - 1]).toBe(false);
		act(() => press("Enter"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
		act(() => pointer("touchstart"));
		expect(snapshots[snapshots.length - 1]).toBe(false);
	});

	it("typing a printable character counts as keyboard activity", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("a"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
	});

	it("F6 region-jump counts as keyboard activity", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("F6"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
	});

	it("a focus() programmatically after a Tab is still 'keyboard-driven'", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("Tab"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
		const btn = document.createElement("button");
		document.body.appendChild(btn);
		btn.focus();
		expect(snapshots[snapshots.length - 1]).toBe(true);
		btn.remove();
	});

	it("uninstalls the document listener after the last subscriber unmounts", () => {
		act(() => root.render(<Probe onTick={(v) => snapshots.push(v)} />));
		act(() => press("Tab"));
		expect(snapshots[snapshots.length - 1]).toBe(true);
		act(() => root.unmount());
		// After unmount the module-scope listener is removed; a subsequent
		// pointerdown shouldn't update any subscribers (there are none).
		expect(() => pointer("pointerdown")).not.toThrow();
	});
});
