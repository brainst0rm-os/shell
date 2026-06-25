// @vitest-environment jsdom
/**
 * use-anchored-panel — the shared flip + dismiss plumbing that both
 * `CellPopover` and `AddPropertyMenuPlugin` consume. Covers the flip
 * threshold (pure) and the outside-mousedown / Escape dismiss (hook).
 */

import { createElement, useRef } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EscapeMatcher, defaultEscapeMatcher } from "./seams";
import {
	type PanelAnchor,
	computeAnchoredPanelStyle,
	useAnchoredPanel,
} from "./use-anchored-panel";

describe("computeAnchoredPanelStyle", () => {
	beforeEach(() => {
		Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
		Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
	});

	it("places the panel below the anchor when there is room", () => {
		const anchor: PanelAnchor = { top: 100, left: 50, bottom: 120 };
		const s = computeAnchoredPanelStyle(anchor, 260, 320, 6);
		expect(s.top).toBe(126);
		expect(s.left).toBe(50);
	});

	it("flips the panel above the anchor when there is no room below", () => {
		const anchor: PanelAnchor = { top: 700, left: 50, bottom: 720 };
		const s = computeAnchoredPanelStyle(anchor, 260, 320, 6);
		// 800 - 720 = 80 < 320 + 6 → flip above.
		expect(s.top).toBe(700 - 320 - 6);
	});

	it("clamps horizontally into the viewport", () => {
		const anchor: PanelAnchor = { top: 100, left: 980, bottom: 120 };
		const s = computeAnchoredPanelStyle(anchor, 260, 320, 6);
		expect(s.left).toBe(1000 - 260 - 8);
	});
});

function Harness({
	onDismiss,
	escapeMatcher,
}: {
	onDismiss: () => void;
	escapeMatcher: EscapeMatcher | null;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	useAnchoredPanel({
		anchor: { top: 10, left: 10, bottom: 30 },
		width: 200,
		maxHeight: 100,
		gutter: 6,
		ref,
		onDismiss,
		escapeMatcher,
	});
	return createElement("div", { ref, "data-testid": "panel" }, "body");
}

describe("useAnchoredPanel dismiss", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
		Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("dismisses on an outside mousedown but not on an inside one", () => {
		const onDismiss = vi.fn();
		act(() => {
			root.render(createElement(Harness, { onDismiss, escapeMatcher: null }));
		});
		const panel = container.querySelector<HTMLElement>('[data-testid="panel"]');
		act(() => {
			panel?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		expect(onDismiss).not.toHaveBeenCalled();
		act(() => {
			document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("dismisses on the configured Escape matcher, and not when opted out", () => {
		const onDismiss = vi.fn();
		act(() => {
			root.render(
				createElement(Harness, {
					onDismiss,
					escapeMatcher: defaultEscapeMatcher,
				}),
			);
		});
		act(() => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		});
		expect(onDismiss).toHaveBeenCalledTimes(1);

		const onDismiss2 = vi.fn();
		act(() => {
			root.render(createElement(Harness, { onDismiss: onDismiss2, escapeMatcher: null }));
		});
		act(() => {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		});
		expect(onDismiss2).not.toHaveBeenCalled();
	});
});
