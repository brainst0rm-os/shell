import { describe, expect, it } from "vitest";
import { AlignKind, type AlignRect, DistributeAxis, alignRects, distributeRects } from "./align";

function rect(id: string, x: number, y: number, width = 10, height = 10): AlignRect {
	return { id, x, y, width, height };
}

describe("alignRects", () => {
	// a: 0..10, b: 100..140 (w40), c: 50..70 (w20) — varied widths/positions.
	const rects = [rect("a", 0, 0, 10, 10), rect("b", 100, 50, 40, 20), rect("c", 50, 30, 20, 30)];

	it("returns positions unchanged for a <2 selection", () => {
		expect(alignRects([rect("a", 5, 7)], AlignKind.Left)).toEqual(new Map([["a", { x: 5, y: 7 }]]));
		expect(alignRects([], AlignKind.Left).size).toBe(0);
	});

	it("aligns left to the bounding-box min x", () => {
		const p = alignRects(rects, AlignKind.Left);
		expect(p.get("a")?.x).toBe(0);
		expect(p.get("b")?.x).toBe(0);
		expect(p.get("c")?.x).toBe(0);
		expect(p.get("b")?.y).toBe(50); // y untouched
	});

	it("aligns right to the bounding-box max right, accounting for width", () => {
		// bbox right = max(10, 140, 70) = 140
		const p = alignRects(rects, AlignKind.Right);
		expect(p.get("a")?.x).toBe(130); // 140 - 10
		expect(p.get("b")?.x).toBe(100); // 140 - 40
		expect(p.get("c")?.x).toBe(120); // 140 - 20
	});

	it("centers horizontally on the bounding-box center", () => {
		// bbox x: 0..140 → center 70
		const p = alignRects(rects, AlignKind.CenterX);
		expect(p.get("a")?.x).toBe(65); // 70 - 5
		expect(p.get("b")?.x).toBe(50); // 70 - 20
		expect(p.get("c")?.x).toBe(60); // 70 - 10
	});

	it("aligns top / middle / bottom on the y axis only", () => {
		// bbox y: 0..70 → top 0, center 35, bottom 70
		expect(alignRects(rects, AlignKind.Top).get("b")?.y).toBe(0);
		expect(alignRects(rects, AlignKind.MiddleY).get("b")?.y).toBe(25); // 35 - 10
		expect(alignRects(rects, AlignKind.Bottom).get("b")?.y).toBe(50); // 70 - 20
		expect(alignRects(rects, AlignKind.Top).get("b")?.x).toBe(100); // x untouched
	});
});

describe("distributeRects", () => {
	it("returns positions unchanged for a <3 selection", () => {
		const two = [rect("a", 0, 0), rect("b", 100, 0)];
		expect(distributeRects(two, DistributeAxis.Horizontal)).toEqual(
			new Map([
				["a", { x: 0, y: 0 }],
				["b", { x: 100, y: 0 }],
			]),
		);
	});

	it("equalizes horizontal gaps with the extremes anchored", () => {
		// widths 10 each; span 0..110 (a:0, c:100..110); total width 30; gap = (110-30)/2 = 40
		const p = distributeRects(
			[rect("a", 0, 0), rect("b", 20, 0), rect("c", 100, 0)],
			DistributeAxis.Horizontal,
		);
		expect(p.get("a")?.x).toBe(0); // anchored
		expect(p.get("b")?.x).toBe(50); // 0 + 10 + 40
		expect(p.get("c")?.x).toBe(100); // anchored (50 + 10 + 40)
	});

	it("sorts by position first, so input order doesn't matter", () => {
		const p = distributeRects(
			[rect("c", 100, 0), rect("a", 0, 0), rect("b", 20, 0)],
			DistributeAxis.Horizontal,
		);
		expect(p.get("b")?.x).toBe(50);
	});

	it("distributes vertically on the y axis", () => {
		const p = distributeRects(
			[rect("a", 0, 0), rect("b", 0, 5), rect("c", 0, 100)],
			DistributeAxis.Vertical,
		);
		expect(p.get("a")?.y).toBe(0);
		expect(p.get("b")?.y).toBe(50);
		expect(p.get("c")?.y).toBe(100);
		expect(p.get("b")?.x).toBe(0); // x untouched
	});
});
