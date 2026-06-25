import { describe, expect, it } from "vitest";
import {
	FitMode,
	MAX_SCALE,
	MIN_SCALE,
	baseScale,
	clampPan,
	clampScale,
	cycleFitMode,
	panBy,
	percentLabel,
	toggleActual,
	viewForMode,
	zoomAt,
} from "./image-view";

const natural = { w: 1000, h: 500 };
const viewport = { w: 800, h: 600 };

describe("clampScale", () => {
	it("clamps to the [MIN, MAX] band", () => {
		expect(clampScale(0)).toBe(MIN_SCALE);
		expect(clampScale(-3)).toBe(MIN_SCALE);
		expect(clampScale(1000)).toBe(MAX_SCALE);
		expect(clampScale(2)).toBe(2);
	});

	it("treats non-finite as MIN", () => {
		expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
		expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
	});
});

describe("baseScale", () => {
	it("Fit picks the limiting axis and never upscales", () => {
		// 800/1000 = 0.8, 600/500 = 1.2 → min = 0.8
		expect(baseScale(natural, viewport, FitMode.Fit)).toBeCloseTo(0.8);
	});

	it("Fit caps at 1 for small images", () => {
		expect(baseScale({ w: 32, h: 32 }, viewport, FitMode.Fit)).toBe(1);
	});

	it("Actual is always 1", () => {
		expect(baseScale(natural, viewport, FitMode.Actual)).toBe(1);
		expect(baseScale({ w: 32, h: 32 }, viewport, FitMode.Actual)).toBe(1);
	});

	it("Fill picks the covering axis", () => {
		// max(0.8, 1.2) = 1.2
		expect(baseScale(natural, viewport, FitMode.Fill)).toBeCloseTo(1.2);
	});

	it("degenerate sizes fall back to 1", () => {
		expect(baseScale({ w: 0, h: 0 }, viewport, FitMode.Fit)).toBe(1);
		expect(baseScale(natural, { w: 0, h: 0 }, FitMode.Fill)).toBe(1);
	});
});

describe("viewForMode", () => {
	it("centres the image and resolves Custom to Fit", () => {
		const v = viewForMode(natural, viewport, FitMode.Custom);
		expect(v.mode).toBe(FitMode.Fit);
		expect(v.tx).toBe(0);
		expect(v.ty).toBe(0);
		expect(v.scale).toBeCloseTo(0.8);
	});
});

describe("clampPan", () => {
	it("force-centres an axis smaller than the viewport", () => {
		const state = { scale: 0.8, tx: 200, ty: 200, mode: FitMode.Custom };
		// At 0.8×: dispW=800 (== viewport), dispH=400 (< 600) → both centred.
		const out = clampPan(state, natural, viewport);
		expect(out.tx).toBe(0);
		expect(out.ty).toBe(0);
	});

	it("bounds pan to the overscan when larger than the viewport", () => {
		const state = { scale: 2, tx: 9999, ty: -9999, mode: FitMode.Custom };
		// dispW = 2000, maxX = (2000-800)/2 = 600; dispH=1000, maxY=(1000-600)/2=200
		const out = clampPan(state, natural, viewport);
		expect(out.tx).toBe(600);
		expect(out.ty).toBe(-200);
	});

	it("returns the same object identity when nothing changes", () => {
		const state = { scale: 2, tx: 10, ty: 10, mode: FitMode.Custom };
		expect(clampPan(state, natural, viewport)).toBe(state);
	});
});

describe("zoomAt", () => {
	it("keeps the anchor point stationary", () => {
		const start = { scale: 1, tx: 0, ty: 0, mode: FitMode.Custom };
		const anchor = { x: 100, y: 50 };
		const zoomed = zoomAt(start, 2, anchor, natural, viewport);
		// local = (anchor - t)/scale = (100,50). After: t' should satisfy
		// anchor = t' + local*scale'  → 100 = t' + 100*2 → t' = -100 (pre-clamp).
		// dispW at scale 2 = 2000, maxX=600 so -100 is within bounds.
		expect(zoomed.scale).toBe(2);
		expect(zoomed.tx).toBeCloseTo(-100);
		expect(zoomed.ty).toBeCloseTo(-50);
		expect(zoomed.mode).toBe(FitMode.Custom);
	});

	it("no-ops at the scale ceiling", () => {
		const start = { scale: MAX_SCALE, tx: 0, ty: 0, mode: FitMode.Custom };
		expect(zoomAt(start, 2, { x: 0, y: 0 }, natural, viewport)).toBe(start);
	});

	it("clamps the resulting pan", () => {
		const start = { scale: 1, tx: 0, ty: 0, mode: FitMode.Custom };
		const zoomed = zoomAt(start, 10, { x: 400, y: 300 }, natural, viewport);
		// Heavily off-centre anchor would push pan out of bounds; result
		// must stay within the overscan box.
		const dispW = natural.w * zoomed.scale;
		const maxX = (dispW - viewport.w) / 2;
		expect(Math.abs(zoomed.tx)).toBeLessThanOrEqual(maxX + 0.001);
	});
});

describe("panBy", () => {
	it("accumulates the delta and clamps", () => {
		const start = { scale: 2, tx: 0, ty: 0, mode: FitMode.Custom };
		const out = panBy(start, 100, 50, natural, viewport);
		expect(out.tx).toBe(100);
		expect(out.ty).toBe(50);
		const pinned = panBy(start, 100000, 0, natural, viewport);
		expect(pinned.tx).toBe(600); // clamped to maxX
	});
});

describe("cycleFitMode", () => {
	it("walks Fit → Actual → Fill → Fit", () => {
		expect(cycleFitMode(FitMode.Fit)).toBe(FitMode.Actual);
		expect(cycleFitMode(FitMode.Actual)).toBe(FitMode.Fill);
		expect(cycleFitMode(FitMode.Fill)).toBe(FitMode.Fit);
	});

	it("snaps Custom back to Fit", () => {
		expect(cycleFitMode(FitMode.Custom)).toBe(FitMode.Fit);
	});
});

describe("toggleActual", () => {
	it("jumps from fit to actual size", () => {
		const fit = viewForMode(natural, viewport, FitMode.Fit); // scale 0.8
		const out = toggleActual(fit, { x: 0, y: 0 }, natural, viewport);
		expect(out.scale).toBe(1);
		expect(out.mode).toBe(FitMode.Custom);
	});

	it("snaps from actual back to fit", () => {
		const actual = { scale: 1, tx: 0, ty: 0, mode: FitMode.Custom };
		const out = toggleActual(actual, { x: 0, y: 0 }, natural, viewport);
		expect(out.mode).toBe(FitMode.Fit);
		expect(out.scale).toBeCloseTo(0.8);
	});
});

describe("percentLabel", () => {
	it("rounds to a whole percent", () => {
		expect(percentLabel(1)).toBe("100%");
		expect(percentLabel(0.8)).toBe("80%");
		expect(percentLabel(2.345)).toBe("235%");
	});
});
