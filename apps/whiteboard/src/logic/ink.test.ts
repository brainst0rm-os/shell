import { describe, expect, it } from "vitest";
import { MIN_INK_POINTS, buildInkGeometry, coerceInkPoints, inkPointsAttr } from "./ink";

describe("buildInkGeometry", () => {
	it("returns null below the minimum point count", () => {
		expect(buildInkGeometry([])).toBeNull();
		expect(buildInkGeometry([{ x: 1, y: 1 }])).toBeNull();
		expect(MIN_INK_POINTS).toBe(2);
	});

	it("boxes the stroke bbox with padding and normalises to 0..100", () => {
		const geo = buildInkGeometry([
			{ x: 100, y: 200 },
			{ x: 300, y: 200 },
			{ x: 300, y: 400 },
		]);
		expect(geo).not.toBeNull();
		if (!geo) return;
		// bbox is 100..300 × 200..400, padded by 8 each side.
		expect(geo.x).toBe(92);
		expect(geo.y).toBe(192);
		expect(geo.width).toBe(216);
		expect(geo.height).toBe(216);
		// First point sits one pad-width in → 8/216 * 100 ≈ 3.70.
		expect(geo.points[0]?.x).toBeCloseTo((8 / 216) * 100, 5);
		// Every normalised coord is within [0,100].
		for (const p of geo.points) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x).toBeLessThanOrEqual(100);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeLessThanOrEqual(100);
		}
	});

	it("handles a degenerate (zero-extent) stroke without dividing by zero", () => {
		const geo = buildInkGeometry([
			{ x: 50, y: 50 },
			{ x: 50, y: 50 },
		]);
		expect(geo).not.toBeNull();
		if (!geo) return;
		expect(Number.isFinite(geo.points[0]?.x ?? Number.NaN)).toBe(true);
		expect(geo.width).toBe(16); // padding only
	});
});

describe("inkPointsAttr", () => {
	it("formats points as a rounded SVG points string", () => {
		expect(
			inkPointsAttr([
				{ x: 1.234, y: 2.0 },
				{ x: 3, y: 4.567 },
			]),
		).toBe("1.23,2 3,4.57");
	});
});

describe("coerceInkPoints", () => {
	it("keeps finite {x,y} entries and drops the rest", () => {
		const out = coerceInkPoints([
			{ x: 1, y: 2 },
			{ x: "bad", y: 2 },
			{ x: 3, y: 4 },
			null,
			{ x: Number.POSITIVE_INFINITY, y: 0 },
		]);
		expect(out).toEqual([
			{ x: 1, y: 2 },
			{ x: 3, y: 4 },
		]);
	});

	it("returns null below the minimum or for non-arrays", () => {
		expect(coerceInkPoints("nope")).toBeNull();
		expect(coerceInkPoints([{ x: 1, y: 1 }])).toBeNull();
		expect(coerceInkPoints([])).toBeNull();
	});
});
