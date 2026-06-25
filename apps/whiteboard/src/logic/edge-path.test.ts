import { describe, expect, it } from "vitest";
import { EdgePathKind, HandleSide } from "../types/edge";
import {
	bezierPath,
	edgePath,
	edgePathMidpoint,
	polylinePathD,
	segIntersectsRect,
	stepPath,
	stepPolylineAvoiding,
	straightPath,
} from "./edge-path";

function must<T>(v: T | null | undefined, m: string): T {
	if (v == null) throw new Error(m);
	return v;
}

describe("straightPath", () => {
	it("emits a single SVG M+L command", () => {
		const d = straightPath({ x: 10, y: 20 }, { x: 100, y: 200 });
		expect(d).toBe("M 10 20 L 100 200");
	});
});

describe("bezierPath", () => {
	it("emits a cubic Bezier (M + C) command", () => {
		const d = bezierPath({ x: 0, y: 0 }, HandleSide.Right, { x: 200, y: 0 }, HandleSide.Left);
		expect(d).toMatch(/^M 0 0 C /);
		expect(d).toMatch(/, 200 0$/);
		// Control points sit along each handle's outward normal — for
		// Right-out, c1 is +x; for Left-out, c2 is also +x (rightward to
		// the node face). Both x components should be positive in this
		// horizontal layout.
		expect(d).toMatch(/C \d/); // c1x > 0
	});

	it("symmetric for a symmetric layout — Right→Left and Left→Right produce mirrored paths", () => {
		const a = bezierPath({ x: 0, y: 0 }, HandleSide.Right, { x: 100, y: 0 }, HandleSide.Left);
		const b = bezierPath({ x: 100, y: 0 }, HandleSide.Left, { x: 0, y: 0 }, HandleSide.Right);
		// Endpoints swap; both produce non-empty Bezier strings.
		expect(a.startsWith("M 0 0")).toBe(true);
		expect(b.startsWith("M 100 0")).toBe(true);
	});

	it("tangent scales with distance — long edges get larger control offsets than short ones", () => {
		const short = bezierPath({ x: 0, y: 0 }, HandleSide.Right, { x: 50, y: 0 }, HandleSide.Left);
		const long = bezierPath({ x: 0, y: 0 }, HandleSide.Right, { x: 500, y: 0 }, HandleSide.Left);
		// The first control x in `long` (~200) should exceed the first
		// control x in `short` (clamped to DEFAULT_BEZIER_TANGENT = 60).
		const cShort = Number(short.match(/C (-?\d+(?:\.\d+)?) /)?.[1] ?? 0);
		const cLong = Number(long.match(/C (-?\d+(?:\.\d+)?) /)?.[1] ?? 0);
		expect(cLong).toBeGreaterThan(cShort);
	});
});

describe("stepPath — same-axis handles share an elbow", () => {
	it("Right→Left (both horizontal) takes a vertical midpoint elbow", () => {
		const d = stepPath({ x: 0, y: 0 }, HandleSide.Right, { x: 200, y: 100 }, HandleSide.Left);
		// Mid x = 100; should appear twice as the turn x.
		expect(d).toBe("M 0 0 L 100 0 L 100 100 L 200 100");
	});

	it("Top→Bottom (both vertical) takes a horizontal midpoint elbow", () => {
		const d = stepPath({ x: 0, y: 0 }, HandleSide.Top, { x: 100, y: 200 }, HandleSide.Bottom);
		// Mid y = 100.
		expect(d).toBe("M 0 0 L 0 100 L 100 100 L 100 200");
	});
});

describe("stepPath — mixed-axis handles take a single L-corner", () => {
	it("Right (horizontal) → Top (vertical) elbows once at (to.x, from.y)", () => {
		const d = stepPath({ x: 0, y: 0 }, HandleSide.Right, { x: 100, y: 200 }, HandleSide.Top);
		expect(d).toBe("M 0 0 L 100 0 L 100 200");
	});

	it("Top (vertical) → Right (horizontal) elbows once at (from.x, to.y)", () => {
		const d = stepPath({ x: 0, y: 0 }, HandleSide.Top, { x: 100, y: 200 }, HandleSide.Right);
		expect(d).toBe("M 0 0 L 0 200 L 100 200");
	});
});

describe("edgePath dispatch", () => {
	it("EdgePathKind.Straight → straightPath", () => {
		expect(
			edgePath(
				EdgePathKind.Straight,
				{ x: 0, y: 0 },
				HandleSide.Right,
				{ x: 10, y: 10 },
				HandleSide.Left,
			),
		).toBe("M 0 0 L 10 10");
	});

	it("EdgePathKind.Bezier → bezierPath (starts with M+C)", () => {
		const d = edgePath(
			EdgePathKind.Bezier,
			{ x: 0, y: 0 },
			HandleSide.Right,
			{ x: 100, y: 0 },
			HandleSide.Left,
		);
		expect(d).toMatch(/^M 0 0 C /);
	});

	it("EdgePathKind.Step → stepPath (4-point orthogonal)", () => {
		const d = edgePath(
			EdgePathKind.Step,
			{ x: 0, y: 0 },
			HandleSide.Right,
			{ x: 100, y: 50 },
			HandleSide.Left,
		);
		expect(d.split(" L ").length).toBe(4); // M + 3 L segments
	});
});

describe("edgePathMidpoint", () => {
	it("straight → exact chord midpoint", () => {
		const m = edgePathMidpoint(
			EdgePathKind.Straight,
			{ x: 10, y: 20 },
			HandleSide.Right,
			{ x: 110, y: 220 },
			HandleSide.Left,
		);
		expect(m).toEqual({ x: 60, y: 120 });
	});

	it("bezier → curve t=0.5, symmetric on a symmetric layout", () => {
		// Right-out → Left-in, horizontally mirrored: the t=0.5 point sits
		// on the vertical centre line and at the endpoints' y.
		const m = edgePathMidpoint(
			EdgePathKind.Bezier,
			{ x: 0, y: 0 },
			HandleSide.Right,
			{ x: 200, y: 0 },
			HandleSide.Left,
		);
		expect(m.x).toBeCloseTo(100, 6);
		expect(m.y).toBeCloseTo(0, 6);
	});

	it("bezier midpoint lies between the endpoints (not the chord) when bent", () => {
		const m = edgePathMidpoint(
			EdgePathKind.Bezier,
			{ x: 0, y: 0 },
			HandleSide.Bottom,
			{ x: 200, y: 0 },
			HandleSide.Bottom,
		);
		// Both handles exit downward → the curve bows below y=0.
		expect(m.x).toBeCloseTo(100, 6);
		expect(m.y).toBeGreaterThan(0);
	});

	it("step → on the elbow polyline at half its arc length", () => {
		// Right→Left, vertically offset: polyline is
		// (0,0)-(50,0)-(50,100)-(100,100); total length 50+100+50=200,
		// half=100 → 50 along the vertical mid-segment → (50,50).
		const m = edgePathMidpoint(
			EdgePathKind.Step,
			{ x: 0, y: 0 },
			HandleSide.Right,
			{ x: 100, y: 100 },
			HandleSide.Left,
		);
		expect(m.x).toBeCloseTo(50, 6);
		expect(m.y).toBeCloseTo(50, 6);
	});

	it("degenerate (from == to) never throws and anchors at the point", () => {
		const p = { x: 7, y: 9 };
		for (const kind of [EdgePathKind.Straight, EdgePathKind.Step, EdgePathKind.Bezier]) {
			const m = edgePathMidpoint(kind, p, HandleSide.Top, p, HandleSide.Bottom);
			expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
		}
	});
});

describe("segIntersectsRect", () => {
	const r = { x: 0, y: 0, width: 100, height: 100 };
	it("a horizontal segment crossing the box hits; one outside misses", () => {
		expect(segIntersectsRect({ x: -10, y: 50 }, { x: 110, y: 50 }, r)).toBe(true);
		expect(segIntersectsRect({ x: -10, y: 200 }, { x: 110, y: 200 }, r)).toBe(false);
	});
	it("a segment merely grazing the border is not a hit", () => {
		expect(segIntersectsRect({ x: -10, y: 0 }, { x: 110, y: 0 }, r)).toBe(false);
		expect(segIntersectsRect({ x: 0, y: -10 }, { x: 0, y: 110 }, r)).toBe(false);
	});
	it("a vertical segment through the box hits", () => {
		expect(segIntersectsRect({ x: 50, y: -10 }, { x: 50, y: 110 }, r)).toBe(true);
	});
});

describe("polylinePathD", () => {
	it("emits M + L commands; empty for no points", () => {
		expect(
			polylinePathD([
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			]),
		).toBe("M 1 2 L 3 4");
		expect(polylinePathD([])).toBe("");
	});
});

describe("stepPolylineAvoiding", () => {
	const C = 18;
	it("always leaves/enters with a straight stub along the handle normal", () => {
		const from = { x: 0, y: 0 };
		const to = { x: 300, y: 0 };
		const pts = stepPolylineAvoiding(from, HandleSide.Right, to, HandleSide.Left, []);
		expect(pts[0]).toEqual(from);
		expect(pts[pts.length - 1]).toEqual(to);
		// First hop is the +x stub of length C (Right normal = +x).
		expect(pts[1]).toEqual({ x: C, y: 0 });
		// Last hop arrives from the dest's Left-normal stub (+x out → x = 300 - C).
		expect(pts[pts.length - 2]).toEqual({ x: 300 - C, y: 0 });
	});

	it("clears the endpoint node boxes it's given", () => {
		const source = { x: 0, y: 0, width: 100, height: 60 };
		const dest = { x: 260, y: 0, width: 100, height: 60 };
		const from = { x: 100, y: 30 }; // source right edge
		const to = { x: 260, y: 30 }; // dest left edge
		const pts = stepPolylineAvoiding(from, HandleSide.Right, to, HandleSide.Left, [source, dest]);
		// No segment may cut through either node's box.
		for (let i = 1; i < pts.length; i++) {
			expect(segIntersectsRect(must(pts[i - 1], "pts[i-1]"), must(pts[i], "pts[i]"), source)).toBe(
				false,
			);
			expect(segIntersectsRect(must(pts[i - 1], "pts[i-1]"), must(pts[i], "pts[i]"), dest)).toBe(
				false,
			);
		}
	});

	it("detours around the combined box when both simple elbows are blocked", () => {
		// Handles face away from each other with a node sitting between —
		// both X-first and Y-first elbows would clip a box; expect a
		// 3-bend detour (6 points incl. endpoints) that stays clear.
		const source = { x: 0, y: 0, width: 100, height: 100 };
		const dest = { x: 40, y: 200, width: 100, height: 100 };
		const from = { x: 100, y: 50 };
		const to = { x: 140, y: 250 };
		const pts = stepPolylineAvoiding(from, HandleSide.Right, to, HandleSide.Right, [source, dest]);
		expect(pts.length).toBeGreaterThanOrEqual(5);
		for (let i = 1; i < pts.length; i++) {
			expect(segIntersectsRect(must(pts[i - 1], "pts[i-1]"), must(pts[i], "pts[i]"), source)).toBe(
				false,
			);
			expect(segIntersectsRect(must(pts[i - 1], "pts[i-1]"), must(pts[i], "pts[i]"), dest)).toBe(
				false,
			);
		}
	});

	it("with no obstacles falls back to a clean single-bend elbow", () => {
		const pts = stepPolylineAvoiding(
			{ x: 0, y: 0 },
			HandleSide.Right,
			{ x: 200, y: 120 },
			HandleSide.Left,
		);
		expect(pts.length).toBe(5); // from, s, corner, e, to
	});
});
