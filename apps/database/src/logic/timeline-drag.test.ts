/**
 * Tests for the 9.12.10 timeline-drag math — pixel→day conversion,
 * move shifting (span + point event), resize clamping, drag threshold.
 */

import { describe, expect, it } from "vitest";
import {
	DAY_MS,
	DRAG_THRESHOLD_PX,
	dragDeltaDays,
	isDragMovement,
	movedDates,
	resizedEnd,
} from "./timeline-drag";

const T0 = 1_700_000_000_000;

describe("dragDeltaDays", () => {
	it("rounds the pixel delta to whole days at the current zoom", () => {
		expect(dragDeltaDays(64, 32)).toBe(2);
		expect(dragDeltaDays(47, 32)).toBe(1);
		expect(dragDeltaDays(49, 32)).toBe(2);
		expect(dragDeltaDays(-64, 32)).toBe(-2);
	});

	it("a sub-half-day drag is zero days (no write)", () => {
		expect(dragDeltaDays(10, 32)).toBe(0);
	});

	it("degenerate zoom values produce no delta", () => {
		expect(dragDeltaDays(100, 0)).toBe(0);
		expect(dragDeltaDays(100, Number.NaN)).toBe(0);
		expect(dragDeltaDays(Number.NaN, 32)).toBe(0);
	});
});

describe("movedDates", () => {
	it("shifts both ends of a span", () => {
		const next = movedDates({ start: T0, end: T0 + 3 * DAY_MS }, 2);
		expect(next.start).toBe(T0 + 2 * DAY_MS);
		expect(next.end).toBe(T0 + 5 * DAY_MS);
	});

	it("shifts a point event and keeps end null", () => {
		const next = movedDates({ start: T0, end: null }, -1);
		expect(next.start).toBe(T0 - DAY_MS);
		expect(next.end).toBeNull();
	});
});

describe("resizedEnd", () => {
	it("extends and shrinks the end by whole days", () => {
		expect(resizedEnd(T0, T0 + 3 * DAY_MS, 2)).toBe(T0 + 5 * DAY_MS);
		expect(resizedEnd(T0, T0 + 3 * DAY_MS, -2)).toBe(T0 + DAY_MS);
	});

	it("clamps so the span never inverts", () => {
		expect(resizedEnd(T0, T0 + 2 * DAY_MS, -10)).toBe(T0);
	});
});

describe("isDragMovement", () => {
	it("treats sub-threshold movement as a click", () => {
		expect(isDragMovement(DRAG_THRESHOLD_PX - 1)).toBe(false);
		expect(isDragMovement(DRAG_THRESHOLD_PX)).toBe(true);
		expect(isDragMovement(-DRAG_THRESHOLD_PX)).toBe(true);
	});
});
