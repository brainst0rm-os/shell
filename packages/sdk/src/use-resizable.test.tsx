// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useResizable } from "./use-resizable";

function Harness({
	side = "left" as const,
	storageKey,
}: {
	side?: "left" | "right";
	storageKey?: string;
}) {
	const { handleProps, width } = useResizable({
		side,
		defaultWidth: 260,
		min: 160,
		max: 560,
		...(storageKey !== undefined ? { storageKey } : {}),
	});
	return (
		<div>
			<div data-testid="handle" {...handleProps} />
			<output data-testid="width">{width}</output>
		</div>
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	globalThis.localStorage?.clear();
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const handle = () => container.querySelector<HTMLElement>('[data-testid="handle"]');
const widthValue = () => Number(container.querySelector('[data-testid="width"]')?.textContent);
const key = (el: HTMLElement, init: KeyboardEventInit) =>
	act(() => {
		el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
	});

describe("useResizable", () => {
	it("spreads a separator role, tabindex, and aria-orientation onto the handle", () => {
		act(() => root.render(<Harness />));
		const h = handle();
		expect(h?.getAttribute("role")).toBe("separator");
		expect(h?.tabIndex).toBe(0);
		expect(h?.getAttribute("aria-orientation")).toBe("vertical");
	});

	it("starts at the default width", () => {
		act(() => root.render(<Harness />));
		expect(widthValue()).toBe(260);
	});

	it("ArrowRight grows a left panel by 8px; Shift makes it 32px", () => {
		act(() => root.render(<Harness side="left" />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "ArrowRight" });
		expect(widthValue()).toBe(268);
		key(h, { key: "ArrowRight", shiftKey: true });
		expect(widthValue()).toBe(300);
	});

	it("ArrowRight shrinks a right panel (inverted axis)", () => {
		act(() => root.render(<Harness side="right" />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "ArrowRight" });
		expect(widthValue()).toBe(252);
	});

	it("Home / End snap to min / max", () => {
		act(() => root.render(<Harness />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "End" });
		expect(widthValue()).toBe(560);
		key(h, { key: "Home" });
		expect(widthValue()).toBe(160);
	});

	it("clamps to min/max", () => {
		act(() => root.render(<Harness />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "Home" });
		key(h, { key: "ArrowLeft", shiftKey: true });
		expect(widthValue()).toBe(160);
	});

	it("double-click resets to the default width", () => {
		act(() => root.render(<Harness />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "End" });
		expect(widthValue()).toBe(560);
		act(() => h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
		expect(widthValue()).toBe(260);
	});

	it("persists to localStorage when storageKey is set and rehydrates on mount", () => {
		act(() => root.render(<Harness storageKey="test:w" />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "ArrowRight", shiftKey: true });
		expect(globalThis.localStorage?.getItem("test:w")).toBe("292");

		// Remount: the persisted width seeds the initial state.
		act(() => root.unmount());
		root = createRoot(container);
		act(() => root.render(<Harness storageKey="test:w" />));
		expect(widthValue()).toBe(292);
	});

	it("ignores non-resize keys", () => {
		act(() => root.render(<Harness />));
		const h = handle();
		if (!h) throw new Error("no handle");
		key(h, { key: "Enter" });
		expect(widthValue()).toBe(260);
	});
});
