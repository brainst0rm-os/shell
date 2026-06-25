// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ResizableHandle, attachResizable } from "./resizable";

function makeHandle(): HTMLElement {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return el;
}

function pointerDown(handle: HTMLElement, x: number, pointerId = 1): void {
	handle.dispatchEvent(
		new PointerEvent("pointerdown", { clientX: x, button: 0, pointerId, bubbles: true }),
	);
}

function pointerMove(handle: HTMLElement, x: number, pointerId = 1): void {
	handle.dispatchEvent(new PointerEvent("pointermove", { clientX: x, pointerId, bubbles: true }));
}

function pointerUp(handle: HTMLElement, pointerId = 1): void {
	handle.dispatchEvent(new PointerEvent("pointerup", { pointerId, bubbles: true }));
}

describe("attachResizable", () => {
	let handles: ResizableHandle[];

	beforeEach(() => {
		handles = [];
		localStorage.clear();
	});

	afterEach(() => {
		for (const h of handles) h.destroy();
	});

	it("emits the default width synchronously on attach", () => {
		const onWidth = vi.fn();
		const h = makeHandle();
		handles.push(attachResizable({ handle: h, side: "left", defaultWidth: 240, onWidth }));
		expect(onWidth).toHaveBeenCalledWith(240);
	});

	it("left-side drag follows pointer delta", () => {
		const onWidth = vi.fn();
		const h = makeHandle();
		handles.push(attachResizable({ handle: h, side: "left", defaultWidth: 200, onWidth }));
		onWidth.mockClear();
		pointerDown(h, 100);
		pointerMove(h, 160);
		expect(onWidth).toHaveBeenLastCalledWith(260);
		pointerMove(h, 80);
		expect(onWidth).toHaveBeenLastCalledWith(180);
		pointerUp(h);
	});

	it("right-side drag inverts pointer delta", () => {
		const onWidth = vi.fn();
		const h = makeHandle();
		handles.push(attachResizable({ handle: h, side: "right", defaultWidth: 300, onWidth }));
		onWidth.mockClear();
		pointerDown(h, 500);
		pointerMove(h, 400);
		expect(onWidth).toHaveBeenLastCalledWith(400);
		pointerUp(h);
	});

	it("clamps width to [min, max]", () => {
		const onWidth = vi.fn();
		const h = makeHandle();
		handles.push(
			attachResizable({
				handle: h,
				side: "left",
				defaultWidth: 240,
				min: 180,
				max: 360,
				onWidth,
			}),
		);
		onWidth.mockClear();
		pointerDown(h, 100);
		pointerMove(h, -1000);
		expect(onWidth).toHaveBeenLastCalledWith(180);
		pointerMove(h, 10000);
		expect(onWidth).toHaveBeenLastCalledWith(360);
		pointerUp(h);
	});

	it("persists to localStorage on drag end and rehydrates on next attach", () => {
		const h1 = makeHandle();
		const onWidth1 = vi.fn();
		handles.push(
			attachResizable({
				handle: h1,
				side: "left",
				defaultWidth: 240,
				storageKey: "test:sidebar",
				onWidth: onWidth1,
			}),
		);
		pointerDown(h1, 100);
		pointerMove(h1, 180);
		pointerUp(h1);
		expect(localStorage.getItem("test:sidebar")).toBe("320");

		const h2 = makeHandle();
		const onWidth2 = vi.fn();
		handles.push(
			attachResizable({
				handle: h2,
				side: "left",
				defaultWidth: 240,
				storageKey: "test:sidebar",
				onWidth: onWidth2,
			}),
		);
		expect(onWidth2).toHaveBeenCalledWith(320);
	});

	it("double-click resets to defaultWidth and persists the reset", () => {
		const h = makeHandle();
		const onWidth = vi.fn();
		handles.push(
			attachResizable({
				handle: h,
				side: "left",
				defaultWidth: 240,
				storageKey: "test:reset",
				onWidth,
			}),
		);
		pointerDown(h, 100);
		pointerMove(h, 200);
		pointerUp(h);
		onWidth.mockClear();
		h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(240);
		expect(localStorage.getItem("test:reset")).toBe("240");
	});

	it("arrow keys move the divider (left-side panel)", () => {
		const h = makeHandle();
		const onWidth = vi.fn();
		handles.push(attachResizable({ handle: h, side: "left", defaultWidth: 240, onWidth }));
		onWidth.mockClear();
		h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(248);
		h.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }),
		);
		expect(onWidth).toHaveBeenLastCalledWith(216);
	});

	it("arrow keys move the divider in the expected direction for right-side panels", () => {
		const h = makeHandle();
		const onWidth = vi.fn();
		handles.push(attachResizable({ handle: h, side: "right", defaultWidth: 300, onWidth }));
		onWidth.mockClear();
		h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(308);
		h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(300);
	});

	it("Home / End snap to min and max", () => {
		const h = makeHandle();
		const onWidth = vi.fn();
		handles.push(
			attachResizable({
				handle: h,
				side: "left",
				defaultWidth: 240,
				min: 180,
				max: 480,
				onWidth,
			}),
		);
		h.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(180);
		h.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		expect(onWidth).toHaveBeenLastCalledWith(480);
	});

	it("destroy detaches listeners", () => {
		const h = makeHandle();
		const onWidth = vi.fn();
		const handle = attachResizable({
			handle: h,
			side: "left",
			defaultWidth: 240,
			onWidth,
		});
		handle.destroy();
		onWidth.mockClear();
		pointerDown(h, 100);
		pointerMove(h, 200);
		expect(onWidth).not.toHaveBeenCalled();
	});

	it("ignores stale persisted values outside the clamp range", () => {
		localStorage.setItem("test:stale", "9999");
		const h = makeHandle();
		const onWidth = vi.fn();
		handles.push(
			attachResizable({
				handle: h,
				side: "left",
				defaultWidth: 240,
				min: 180,
				max: 480,
				storageKey: "test:stale",
				onWidth,
			}),
		);
		expect(onWidth).toHaveBeenCalledWith(480);
	});

	describe("animated setWidth", () => {
		let rafCallbacks: FrameRequestCallback[];
		let now: number;
		const originalRaf = window.requestAnimationFrame;
		const originalCancel = window.cancelAnimationFrame;
		const originalMatchMedia = window.matchMedia;
		const originalPerf = globalThis.performance;

		beforeEach(() => {
			rafCallbacks = [];
			now = 0;
			window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
				rafCallbacks.push(cb);
				return rafCallbacks.length;
			}) as typeof window.requestAnimationFrame;
			window.cancelAnimationFrame = vi.fn();
			window.matchMedia = vi.fn().mockReturnValue({
				matches: false,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}) as unknown as typeof window.matchMedia;
			Object.defineProperty(globalThis, "performance", {
				value: { now: () => now },
				configurable: true,
			});
		});

		afterEach(() => {
			window.requestAnimationFrame = originalRaf;
			window.cancelAnimationFrame = originalCancel;
			window.matchMedia = originalMatchMedia;
			Object.defineProperty(globalThis, "performance", {
				value: originalPerf,
				configurable: true,
			});
		});

		function flush(toTime: number): void {
			// One pass per call. The tween's tick re-queues itself at the
			// same simulated time when `t < 1`, so a `while (length)` loop
			// here would spin forever — each iteration re-queues another
			// callback and `now` never advances. Tests step time manually
			// with successive flush() calls instead.
			const cbs = rafCallbacks.splice(0);
			now = toTime;
			for (const cb of cbs) cb(now);
		}

		it("tweens width across frames when { animated: true }", () => {
			const h = makeHandle();
			const onWidth = vi.fn();
			handles.push(
				attachResizable({
					handle: h,
					side: "left",
					defaultWidth: 320,
					min: 0,
					max: 600,
					onWidth,
				}),
			);
			const handle = handles[handles.length - 1];
			onWidth.mockClear();
			handle?.setWidth(0, { animated: true, durationMs: 200 });
			// Initial call hasn't fired yet — the first rAF tick produces the
			// first intermediate value.
			expect(onWidth).not.toHaveBeenCalled();
			flush(100);
			expect(onWidth).toHaveBeenCalled();
			const mid = onWidth.mock.calls[0]?.[0] as number;
			expect(mid).toBeGreaterThan(0);
			expect(mid).toBeLessThan(320);
			flush(250);
			expect(onWidth).toHaveBeenLastCalledWith(0);
		});

		it("persists the animated target immediately so reloads see the final width", () => {
			const h = makeHandle();
			const onWidth = vi.fn();
			handles.push(
				attachResizable({
					handle: h,
					side: "left",
					defaultWidth: 320,
					storageKey: "test:animated-persist",
					onWidth,
				}),
			);
			const handle = handles[handles.length - 1];
			handle?.setWidth(200, { animated: true, durationMs: 200 });
			expect(localStorage.getItem("test:animated-persist")).toBe("200");
		});

		it("animated falls back to instant when prefers-reduced-motion is on", () => {
			window.matchMedia = vi.fn().mockReturnValue({
				matches: true,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}) as unknown as typeof window.matchMedia;
			const h = makeHandle();
			const onWidth = vi.fn();
			handles.push(
				attachResizable({
					handle: h,
					side: "left",
					defaultWidth: 320,
					min: 0,
					max: 600,
					onWidth,
				}),
			);
			const handle = handles[handles.length - 1];
			onWidth.mockClear();
			handle?.setWidth(0, { animated: true, durationMs: 200 });
			expect(onWidth).toHaveBeenCalledTimes(1);
			expect(onWidth).toHaveBeenLastCalledWith(0);
		});

		it("animated setWidth aborts when a drag starts mid-tween", () => {
			const h = makeHandle();
			const onWidth = vi.fn();
			handles.push(
				attachResizable({
					handle: h,
					side: "left",
					defaultWidth: 320,
					min: 0,
					max: 600,
					onWidth,
				}),
			);
			const handle = handles[handles.length - 1];
			onWidth.mockClear();
			handle?.setWidth(0, { animated: true, durationMs: 200 });
			flush(100);
			const callsBeforeDrag = onWidth.mock.calls.length;
			expect(callsBeforeDrag).toBeGreaterThan(0);
			onWidth.mockClear();
			pointerDown(h, 100);
			flush(250);
			// No further animated frames may fire after the drag captured.
			expect(onWidth).not.toHaveBeenCalled();
			pointerUp(h);
		});

		it("animated setWidth declines while a drag is in progress (instant write)", () => {
			const h = makeHandle();
			const onWidth = vi.fn();
			handles.push(
				attachResizable({
					handle: h,
					side: "left",
					defaultWidth: 320,
					min: 0,
					max: 600,
					onWidth,
				}),
			);
			const handle = handles[handles.length - 1];
			pointerDown(h, 100);
			onWidth.mockClear();
			handle?.setWidth(120, { animated: true, durationMs: 200 });
			expect(onWidth).toHaveBeenCalledTimes(1);
			expect(onWidth).toHaveBeenLastCalledWith(120);
			pointerUp(h);
		});
	});
});
