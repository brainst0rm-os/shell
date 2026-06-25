// @vitest-environment jsdom
/**
 * Shortcuts module — chord matching + typing-target suppression mirror
 * the canonical apps/tasks pattern. Per [[feedback_keyboard_and_i18n]]
 * every renderer keystroke routes through an action id.
 */

import { describe, expect, it, vi } from "vitest";
import { ActionId, _DEFAULT_CHORDS, bindShortcut } from "./shortcuts";

function press(key: string, target?: EventTarget | null): void {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	if (target) target.dispatchEvent(event);
	else document.dispatchEvent(event);
}

describe("preview shortcuts", () => {
	it("declares the five action ids the preview drop binds (prev / next / first / last / toggle-inspector)", () => {
		expect(_DEFAULT_CHORDS[ActionId.GoPrev]).toContain("ArrowLeft");
		expect(_DEFAULT_CHORDS[ActionId.GoNext]).toContain("ArrowRight");
		expect(_DEFAULT_CHORDS[ActionId.GoFirst]).toContain("Home");
		expect(_DEFAULT_CHORDS[ActionId.GoLast]).toContain("End");
		expect(_DEFAULT_CHORDS[ActionId.ToggleInspector]).toContain("i");
	});

	it("walks the gallery with PageUp / PageDown as well as the arrows (9.20.6)", () => {
		expect(_DEFAULT_CHORDS[ActionId.GoPrev]).toEqual(["ArrowLeft", "PageUp"]);
		expect(_DEFAULT_CHORDS[ActionId.GoNext]).toEqual(["ArrowRight", "PageDown"]);
		const prev = vi.fn();
		const next = vi.fn();
		const unPrev = bindShortcut(ActionId.GoPrev, prev);
		const unNext = bindShortcut(ActionId.GoNext, next);
		press("PageUp");
		press("PageDown");
		expect(prev).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledOnce();
		unPrev();
		unNext();
	});

	it("fires the handler when its chord is pressed", () => {
		const handler = vi.fn();
		const unbind = bindShortcut(ActionId.GoNext, handler);
		press("ArrowRight");
		expect(handler).toHaveBeenCalledOnce();
		unbind();
	});

	it("ignores keystrokes targeted at typing surfaces (input / textarea / contentEditable)", () => {
		const handler = vi.fn();
		const unbind = bindShortcut(ActionId.GoNext, handler);
		const input = document.createElement("input");
		document.body.appendChild(input);
		press("ArrowRight", input);
		expect(handler).not.toHaveBeenCalled();
		input.remove();
		unbind();
	});

	it("unbind removes the listener", () => {
		const handler = vi.fn();
		const unbind = bindShortcut(ActionId.GoNext, handler);
		unbind();
		press("ArrowRight");
		expect(handler).not.toHaveBeenCalled();
	});

	it("declares the image zoom + pan action ids (9.20.2)", () => {
		expect(_DEFAULT_CHORDS[ActionId.ZoomIn]).toEqual(["=", "+"]);
		expect(_DEFAULT_CHORDS[ActionId.ZoomOut]).toEqual(["-", "_"]);
		expect(_DEFAULT_CHORDS[ActionId.ZoomReset]).toEqual(["0"]);
		expect(_DEFAULT_CHORDS[ActionId.ZoomActual]).toEqual(["1"]);
		expect(_DEFAULT_CHORDS[ActionId.CycleFit]).toContain("f");
		expect(_DEFAULT_CHORDS[ActionId.PanLeft]).toEqual(["ArrowLeft"]);
		expect(_DEFAULT_CHORDS[ActionId.PanDown]).toEqual(["ArrowDown"]);
	});

	it("a capture-phase binding runs before a bubble-phase one and can stop it", () => {
		const order: string[] = [];
		// Bubble-phase host nav (registered first, like app.ts at startup).
		const unbindHost = bindShortcut(ActionId.GoPrev, () => order.push("host"));
		// Capture-phase image pan that consumes the event when "pannable".
		const unbindImg = bindShortcut(
			ActionId.PanLeft,
			(e) => {
				order.push("image");
				e.stopPropagation();
			},
			{ capture: true },
		);
		press("ArrowLeft");
		expect(order).toEqual(["image"]); // host suppressed
		unbindImg();
		unbindHost();
	});

	it("a capture binding that does NOT stop propagation lets the host handler run", () => {
		const order: string[] = [];
		const unbindHost = bindShortcut(ActionId.GoPrev, () => order.push("host"));
		const unbindImg = bindShortcut(ActionId.PanLeft, () => order.push("image"), {
			capture: true,
		});
		press("ArrowLeft");
		expect(order).toEqual(["image", "host"]); // fall-through to file nav
		unbindImg();
		unbindHost();
	});
});
