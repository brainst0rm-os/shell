/**
 * Edge-path SVG `d`-attribute generators — bezier / step / straight —
 * plus `edgePathMidpoint`, the anchor point for an edge's label.
 *
 * **Long-term keystone** per [[preview-drop-pattern]] — the SVG renderer
 * (9.17.1.5 preview) uses `<path d={edgePath(...)}>`; the Pixi swap
 * (9.17.5) reads the same algorithm and walks the path with Pixi's
 * `Graphics.bezierCurveTo` / `lineTo` primitives. The math doesn't
 * change. The `d`-builders and the midpoint share one geometry source
 * (`bezierControlPoints` / `stepPolyline`) so a label can never drift
 * off the line the renderer actually draws (9.17.6b).
 */

import { EdgePathKind, type HandleSide } from "../types/edge";
import { type Point, normalForSide } from "./handle-positions";

/** Default tangent offset for the Bezier control points (in canvas
 *  pixels). Picked to feel taut at typical node sizes (100–300 px) and
 *  not loop-back on short edges. The renderer can override per-edge. */
export const DEFAULT_BEZIER_TANGENT = 60;

/** Generates the `d` attribute string for an edge. `from` + `to` are
 *  the handle anchor points (from `positionForHandle`); the sides are
 *  used by `bezier` + `step` to bias the path's tangent / corner. */
export function edgePath(
	kind: EdgePathKind,
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
): string {
	switch (kind) {
		case EdgePathKind.Bezier:
			return bezierPath(from, fromSide, to, toSide);
		case EdgePathKind.Step:
			return stepPath(from, fromSide, to, toSide);
		case EdgePathKind.Straight:
			return straightPath(from, to);
	}
}

/**
 * The point a label / midpoint affordance anchors to — the geometric
 * middle *of the rendered path*, not the chord midpoint. Bezier uses the
 * curve's `t=0.5`; step walks the elbow polyline to half its arc length;
 * straight is the segment midpoint. Shares the exact control points /
 * polyline the `d`-builders use, so the label sits on the line for every
 * kind (the old `(from+to)/2` floated off bent edges).
 */
export function edgePathMidpoint(
	kind: EdgePathKind,
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
): Point {
	switch (kind) {
		case EdgePathKind.Bezier: {
			const { c1, c2 } = bezierControlPoints(from, fromSide, to, toSide);
			return cubicAt(from, c1, c2, to, 0.5);
		}
		case EdgePathKind.Step:
			return polylineMidpoint(stepPolyline(from, fromSide, to, toSide));
		case EdgePathKind.Straight:
			return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
	}
}

export function straightPath(from: Point, to: Point): string {
	return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

/** Cubic-Bezier with control points offset along each handle's normal.
 *  The tangent length scales with handle distance so short edges stay
 *  taut and long edges arc gracefully. */
export function bezierPath(
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
): string {
	const { c1, c2 } = bezierControlPoints(from, fromSide, to, toSide);
	return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

/** Orthogonal step path — exits the source handle along its normal,
 *  turns once, enters the dest handle along its normal. Good for
 *  flowchart-style routing without obstacle avoidance (which is a
 *  later iteration). */
export function stepPath(from: Point, fromSide: HandleSide, to: Point, toSide: HandleSide): string {
	const pts = stepPolyline(from, fromSide, to, toSide);
	return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
}

// ─── Shared geometry (one source of truth for builders + midpoint) ─────────

/** Control points for the cubic — each offset along its handle's
 *  outward normal by a distance that scales with the chord length. */
export function bezierControlPoints(
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
): { c1: Point; c2: Point } {
	const distance = Math.hypot(to.x - from.x, to.y - from.y);
	const tangent = Math.max(DEFAULT_BEZIER_TANGENT, distance * 0.4);
	const n1 = normalForSide(fromSide);
	const n2 = normalForSide(toSide);
	return {
		c1: { x: from.x + n1.x * tangent, y: from.y + n1.y * tangent },
		c2: { x: to.x + n2.x * tangent, y: to.y + n2.y * tangent },
	};
}

/** The elbow polyline (including both endpoints) the step renderer
 *  strokes. Mixed orientation = one corner; matched = two corners with a
 *  centred mid-line. */
export function stepPolyline(
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
): Point[] {
	const fromHorizontal = fromSide === "left" || fromSide === "right";
	const toHorizontal = toSide === "left" || toSide === "right";

	if (fromHorizontal && toHorizontal) {
		const midX = (from.x + to.x) / 2;
		return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
	}
	if (!fromHorizontal && !toHorizontal) {
		const midY = (from.y + to.y) / 2;
		return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
	}
	if (fromHorizontal) {
		return [from, { x: to.x, y: from.y }, to];
	}
	return [from, { x: from.x, y: to.y }, to];
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
	};
}

/** Point at half the total arc length of a polyline. Falls back to the
 *  first point for a degenerate (zero-length) path so a self-edge still
 *  anchors somewhere sane. Exported so the obstacle-aware step renderer
 *  (9.17.6c) anchors its label on the *routed* path, not the naive one. */
export function polylineMidpoint(pts: readonly Point[]): Point {
	const first = pts[0] ?? { x: 0, y: 0 };
	let total = 0;
	for (let i = 1; i < pts.length; i++) {
		total += dist(pts[i - 1] as Point, pts[i] as Point);
	}
	if (total === 0) return { x: first.x, y: first.y };
	const half = total / 2;
	let walked = 0;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1] as Point;
		const b = pts[i] as Point;
		const seg = dist(a, b);
		if (walked + seg >= half) {
			const f = seg === 0 ? 0 : (half - walked) / seg;
			return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
		}
		walked += seg;
	}
	const last = pts[pts.length - 1] as Point;
	return { x: last.x, y: last.y };
}

function dist(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

// ─── Obstacle-aware step routing (9.17.6c) ─────────────────────────────────

export type Rect = { x: number; y: number; width: number; height: number };

/** Default clearance: how far the path travels straight out of a handle
 *  along its normal before it's allowed to turn. Keeps the first segment
 *  clear of the node it just left (the most common step-path defect) and
 *  gives arrowheads room. */
export const DEFAULT_STEP_CLEARANCE = 18;

/** SVG `d` for any polyline (`M … L … L …`). The obstacle-aware step
 *  renderer + its label share this so they never disagree. */
export function polylinePathD(pts: readonly Point[]): string {
	if (pts.length === 0) return "";
	return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
}

/**
 * Orthogonal step polyline that (a) always leaves/enters each handle with
 * a straight `clearance` stub along its normal and (b) picks the elbow
 * that doesn't cut through the endpoint node rectangles. Scope (v1):
 * avoids the **source + destination** boxes (the visible defect — a
 * connector slicing back across its own nodes). Full scene-wide obstacle
 * avoidance stays out (a visibility-graph problem — a later rung); this
 * is deterministic, allocation-light, and pure so it unit-tests cleanly
 * and survives the 9.17.5 Pixi swap unchanged.
 */
export function stepPolylineAvoiding(
	from: Point,
	fromSide: HandleSide,
	to: Point,
	toSide: HandleSide,
	obstacles: readonly Rect[] = [],
	clearance: number = DEFAULT_STEP_CLEARANCE,
): Point[] {
	const n1 = normalForSide(fromSide);
	const n2 = normalForSide(toSide);
	// Stub endpoints — the path is straight from the handle to here.
	const s: Point = { x: from.x + n1.x * clearance, y: from.y + n1.y * clearance };
	const e: Point = { x: to.x + n2.x * clearance, y: to.y + n2.y * clearance };

	// Two ways to connect s→e with one mid-bend: turn on X first, or on
	// Y first. Each is a 4-point [s, corner, corner, e] polyline.
	const xFirst: Point[] = [s, { x: e.x, y: s.y }, e];
	const yFirst: Point[] = [s, { x: s.x, y: e.y }, e];

	const pad = obstacles.map((r) => inflate(r, clearance / 2));
	const wrap = (mid: Point[]): Point[] => [from, ...mid, to];

	// Only the route *between* the stub endpoints is tested. The stub
	// segments (handle → s, e → handle) deliberately touch their own
	// node — the handle sits on the box boundary — so including them
	// would flag every candidate as blocked.
	const xClear = !polylineHitsAny(xFirst, pad);
	if (xClear) return wrap(xFirst);
	const yClear = !polylineHitsAny(yFirst, pad);
	if (yClear) return wrap(yFirst);

	// Both simple elbows cross an endpoint box (e.g. nodes are close and
	// the handles face each other). Detour around the combined obstacle
	// box: go out to its outside edge on the stub axis, run along, come
	// back in. Deterministic; still only the two endpoint rects.
	const union = pad.reduce<Rect | null>((acc, r) => (acc ? rectUnion(acc, r) : r), null);
	if (!union) return wrap(xFirst);
	const detourX = union.x + union.width + clearance;
	const detour: Point[] = [s, { x: detourX, y: s.y }, { x: detourX, y: e.y }, e];
	return wrap(detour);
}

function inflate(r: Rect, by: number): Rect {
	return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

function rectUnion(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

function polylineHitsAny(pts: readonly Point[], rects: readonly Rect[]): boolean {
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1] as Point;
		const b = pts[i] as Point;
		for (const r of rects) {
			if (segIntersectsRect(a, b, r)) return true;
		}
	}
	return false;
}

/** Axis-aligned segment ↔ rectangle overlap. The whiteboard's step
 *  segments are always horizontal or vertical, so this only handles
 *  those (cheaper + exact); a point merely touching the border is not a
 *  hit (a stub that grazes its own inflated box is fine). */
export function segIntersectsRect(a: Point, b: Point, r: Rect): boolean {
	const left = r.x;
	const right = r.x + r.width;
	const top = r.y;
	const bottom = r.y + r.height;
	if (a.y === b.y) {
		const y = a.y;
		if (y <= top || y >= bottom) return false;
		const x0 = Math.min(a.x, b.x);
		const x1 = Math.max(a.x, b.x);
		return x1 > left && x0 < right;
	}
	if (a.x === b.x) {
		const x = a.x;
		if (x <= left || x >= right) return false;
		const y0 = Math.min(a.y, b.y);
		const y1 = Math.max(a.y, b.y);
		return y1 > top && y0 < bottom;
	}
	// Non-orthogonal (shouldn't occur for step segments) — treat as clear.
	return false;
}
