import { describe, expect, it } from "vitest";
import { SnapAxis, type SnapRect, computeSnap } from "./snap";

const rect = (x: number, y: number, width = 100, height = 100): SnapRect => ({
	x,
	y,
	width,
	height,
});

describe("computeSnap", () => {
	it("returns no nudge when nothing is within threshold", () => {
		const res = computeSnap(rect(0, 0), [rect(500, 500)], 8);
		expect(res).toEqual({ dx: 0, dy: 0, guides: [] });
	});

	it("snaps a left edge to a neighbour's left edge", () => {
		const res = computeSnap(rect(6, 300), [rect(0, 0)], 8);
		expect(res.dx).toBe(-6);
		expect(res.dy).toBe(0);
		const v = res.guides.find((g) => g.axis === SnapAxis.Vertical);
		expect(v?.pos).toBe(0);
	});

	it("aligns centres across the two axes independently", () => {
		// moving centre-x at 53 (x=3,w=100) → snaps to other centre-x 50 (dx -3);
		// moving top at 204 → snaps to other top 200 (dy -4).
		const res = computeSnap(rect(3, 204), [rect(0, 200)], 8);
		expect(res.dx).toBe(-3);
		expect(res.dy).toBe(-4);
		expect(res.guides).toHaveLength(2);
	});

	it("matches cross-edge: moving right edge to a neighbour's left edge", () => {
		// moving right = 100 + (-5)… place moving x=5 (right=105), other left=100 → dx -5.
		const res = computeSnap(rect(5, 999), [rect(100, 0)], 8);
		expect(res.dx).toBe(-5);
	});

	it("prefers the smallest-magnitude alignment among candidates", () => {
		// other A left at x=4 (delta +4 to moving left 0); other B left at x=2 (delta +2).
		const res = computeSnap(rect(0, 0), [rect(4, 0), rect(2, 0)], 8);
		expect(res.dx).toBe(2);
	});

	it("guide span unions the moving rect and its matched neighbour", () => {
		const res = computeSnap(rect(0, 0, 100, 100), [rect(0, 300, 100, 100)], 8);
		const v = res.guides.find((g) => g.axis === SnapAxis.Vertical);
		expect(v).toMatchObject({ pos: 0, from: 0, to: 400 });
	});

	it("is a no-op for a non-positive threshold or empty board", () => {
		expect(computeSnap(rect(1, 1), [rect(0, 0)], 0).guides).toEqual([]);
		expect(computeSnap(rect(1, 1), [], 8)).toEqual({ dx: 0, dy: 0, guides: [] });
	});
});
