// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MOTION_DURATION_ENTRANCE_MS,
	MOTION_DURATION_PANEL_COLLAPSE_MS,
	MOTION_DURATION_PRESS_MS,
	MOTION_SPRING_STANDARD,
	onReducedMotionChange,
	prefersReducedMotion,
	tweenNumber,
} from "./index";

describe("motion tokens", () => {
	it("MOTION_SPRING_STANDARD matches the Settings drawer spring", () => {
		expect(MOTION_SPRING_STANDARD).toEqual({ stiffness: 360, damping: 36 });
	});

	it("motion durations are reasonable", () => {
		expect(MOTION_DURATION_ENTRANCE_MS).toBeGreaterThan(0);
		expect(MOTION_DURATION_PRESS_MS).toBeGreaterThan(0);
		expect(MOTION_DURATION_PANEL_COLLAPSE_MS).toBeGreaterThan(0);
	});
});

describe("prefersReducedMotion", () => {
	const originalMatchMedia = window.matchMedia;

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
	});

	it("returns false when matchMedia is unavailable", () => {
		// @ts-expect-error — deliberately ablating
		window.matchMedia = undefined;
		expect(prefersReducedMotion()).toBe(false);
	});

	it("returns true when the media query matches", () => {
		window.matchMedia = vi.fn().mockReturnValue({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}) as unknown as typeof window.matchMedia;
		expect(prefersReducedMotion()).toBe(true);
	});

	it("returns false when the media query does not match", () => {
		window.matchMedia = vi.fn().mockReturnValue({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}) as unknown as typeof window.matchMedia;
		expect(prefersReducedMotion()).toBe(false);
	});

	it("swallows matchMedia throws", () => {
		window.matchMedia = vi.fn(() => {
			throw new Error("nope");
		}) as unknown as typeof window.matchMedia;
		expect(prefersReducedMotion()).toBe(false);
	});
});

describe("onReducedMotionChange", () => {
	const originalMatchMedia = window.matchMedia;

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
	});

	it("forwards change events to the listener", () => {
		const listeners: ((event: MediaQueryListEvent) => void)[] = [];
		window.matchMedia = vi.fn().mockReturnValue({
			matches: false,
			addEventListener: (_t: string, fn: (event: MediaQueryListEvent) => void) => listeners.push(fn),
			removeEventListener: vi.fn(),
		}) as unknown as typeof window.matchMedia;
		const fn = vi.fn();
		const dispose = onReducedMotionChange(fn);
		expect(listeners.length).toBe(1);
		listeners[0]?.({ matches: true } as MediaQueryListEvent);
		expect(fn).toHaveBeenCalledWith(true);
		dispose();
	});

	it("dispose calls removeEventListener with the same handler", () => {
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		window.matchMedia = vi.fn().mockReturnValue({
			matches: false,
			addEventListener,
			removeEventListener,
		}) as unknown as typeof window.matchMedia;
		const dispose = onReducedMotionChange(vi.fn());
		const [eventName, handler] = addEventListener.mock.calls[0] ?? [];
		expect(eventName).toBe("change");
		dispose();
		expect(removeEventListener).toHaveBeenCalledWith("change", handler);
	});

	it("returns a no-op disposer when matchMedia is missing", () => {
		// @ts-expect-error — deliberately ablating
		window.matchMedia = undefined;
		const dispose = onReducedMotionChange(vi.fn());
		expect(typeof dispose).toBe("function");
		dispose();
	});
});

describe("tweenNumber", () => {
	let rafCallbacks: FrameRequestCallback[];
	let now: number;
	const originalRaf = window.requestAnimationFrame;
	const originalCancel = window.cancelAnimationFrame;
	const originalMatchMedia = window.matchMedia;
	const originalPerformance = globalThis.performance;

	beforeEach(() => {
		rafCallbacks = [];
		now = 0;
		window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return rafCallbacks.length;
		}) as typeof window.requestAnimationFrame;
		window.cancelAnimationFrame = vi.fn();
		// stub matchMedia to "not reduced"
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
			value: originalPerformance,
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

	it("interpolates from start to end across the duration", () => {
		const step = vi.fn();
		tweenNumber(0, 100, 200, step);
		expect(step).not.toHaveBeenCalled();
		flush(100);
		expect(step).toHaveBeenCalled();
		const midValue = step.mock.calls[0]?.[0] as number;
		expect(midValue).toBeGreaterThan(0);
		expect(midValue).toBeLessThan(100);
		flush(250);
		expect(step).toHaveBeenLastCalledWith(100);
	});

	it("calls step once with end and returns a no-op when reduced motion is on", () => {
		window.matchMedia = vi.fn().mockReturnValue({
			matches: true,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}) as unknown as typeof window.matchMedia;
		const step = vi.fn();
		const dispose = tweenNumber(0, 100, 200, step);
		expect(step).toHaveBeenCalledTimes(1);
		expect(step).toHaveBeenCalledWith(100);
		dispose();
	});

	it("dispose() cancels mid-flight frames", () => {
		const step = vi.fn();
		const dispose = tweenNumber(0, 100, 200, step);
		dispose();
		flush(100);
		// First call hasn't happened yet (dispose ran before any tick),
		// and the cancelled flag prevents any further step calls.
		expect(step).not.toHaveBeenCalled();
	});

	it("skips the tween when duration is non-positive", () => {
		const step = vi.fn();
		tweenNumber(0, 100, 0, step);
		expect(step).toHaveBeenCalledTimes(1);
		expect(step).toHaveBeenCalledWith(100);
	});
});
