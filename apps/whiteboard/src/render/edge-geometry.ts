/**
 * Pure edge geometry + colour helpers for the 9.17.5 Pixi renderer —
 * deliberately Pixi-free so it is fully unit-testable (importing
 * `pixi-edges.ts` pulls in `pixi.js`, which needs a GL context jsdom
 * can't give; this mirrors the Graph app's pure-module / untested-Pixi
 * split). `pixi-edges.ts` and `app.ts` both consume these so the GPU
 * paint, the geometric edge-picker, and the label anchor can never
 * disagree (they walk the *same* polyline).
 */

import { bezierControlPoints, stepPolylineAvoiding } from "../logic/edge-path";
import { type Point, positionForHandle } from "../logic/handle-positions";
import { EdgePathKind, type WhiteboardEdge } from "../types/edge";
import type { WhiteboardNode } from "../types/node";

/** A connector + its resolved endpoints, ready to render / pick. */
export type EdgeRenderInput = {
	edge: WhiteboardEdge;
	source: WhiteboardNode;
	dest: WhiteboardNode;
};

/** How many segments a cubic is flattened to. One uniform polyline per
 *  edge kind keeps culling + picking + arrowhead-tangent single-path. */
const BEZIER_FLATTEN_STEPS = 24;

/** Parse a CSS colour string to a 24-bit RGB number Pixi's `.tint` /
 *  `.fill` accept. Handles `#rgb` / `#rrggbb` / `rgb()` / `rgba()`
 *  (alpha dropped — the object's own `.alpha` carries opacity). Unknown
 *  shapes return `fallback` so a connector never vanishes on an
 *  unparseable theme value (fail-open). */
export function cssColorToNumber(input: string, fallback: number): number {
	const s = input.trim();
	if (s.startsWith("#")) {
		const hex = s.slice(1);
		if (hex.length === 3) {
			const r = Number.parseInt(hex[0] ?? "0", 16);
			const g = Number.parseInt(hex[1] ?? "0", 16);
			const b = Number.parseInt(hex[2] ?? "0", 16);
			return r * 17 * 0x10000 + g * 17 * 0x100 + b * 17;
		}
		if (hex.length === 6) return Number.parseInt(hex, 16);
		return fallback;
	}
	const m = s.match(/rgba?\(([^)]+)\)/);
	if (m) {
		const parts = (m[1] ?? "").split(",").map((p) => Number(p.trim()));
		const r = Math.max(0, Math.min(255, parts[0] ?? 0));
		const g = Math.max(0, Math.min(255, parts[1] ?? 0));
		const b = Math.max(0, Math.min(255, parts[2] ?? 0));
		return (r << 16) | (g << 8) | b;
	}
	return fallback;
}

/** The polyline a connector is stroked along — step routes around both
 *  node boxes; bezier is flattened from the analytic control points;
 *  straight is the two endpoints. The GPU renderer, the geometric
 *  edge-picker and the label anchor all call this so they agree. */
export function edgePolyline(input: EdgeRenderInput): Point[] {
	const { edge, source, dest } = input;
	const from = positionForHandle(source, edge.sourceHandle);
	const to = positionForHandle(dest, edge.destHandle);
	const kind = edge.pathKind as EdgePathKind;

	if (kind === EdgePathKind.Step) {
		return stepPolylineAvoiding(from, edge.sourceHandle, to, edge.destHandle, [
			{ x: source.x, y: source.y, width: source.width, height: source.height },
			{ x: dest.x, y: dest.y, width: dest.width, height: dest.height },
		]);
	}
	if (kind === EdgePathKind.Bezier) {
		const { c1, c2 } = bezierControlPoints(from, edge.sourceHandle, to, edge.destHandle);
		const poly: Point[] = [];
		for (let i = 0; i <= BEZIER_FLATTEN_STEPS; i++) {
			const tt = i / BEZIER_FLATTEN_STEPS;
			const u = 1 - tt;
			poly.push({
				x: u * u * u * from.x + 3 * u * u * tt * c1.x + 3 * u * tt * tt * c2.x + tt * tt * tt * to.x,
				y: u * u * u * from.y + 3 * u * u * tt * c1.y + 3 * u * tt * tt * c2.y + tt * tt * tt * to.y,
			});
		}
		return poly;
	}
	return [from, to];
}

/** Squared distance from point `p` to segment `ab` — the kernel of
 *  geometric edge picking (replaces the old wide invisible SVG hit
 *  path). Squared to avoid a `sqrt` in the hot pick loop. */
export function pointSegmentDistSq(p: Point, a: Point, b: Point): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const apx = p.x - a.x;
	const apy = p.y - a.y;
	const len2 = abx * abx + aby * aby;
	const tRaw = len2 === 0 ? 0 : (apx * abx + apy * aby) / len2;
	const tt = Math.max(0, Math.min(1, tRaw));
	const cx = a.x + abx * tt;
	const cy = a.y + aby * tt;
	const dx = p.x - cx;
	const dy = p.y - cy;
	return dx * dx + dy * dy;
}

/** Id of the connector within `tolerance` (canvas-px) of `p`, or null.
 *  Walks the same polylines the GPU strokes. */
export function nearestEdgeId(
	inputs: readonly EdgeRenderInput[],
	p: Point,
	tolerance: number,
): string | null {
	let bestId: string | null = null;
	let bestDistSq = tolerance * tolerance;
	for (const input of inputs) {
		const poly = edgePolyline(input);
		for (let i = 1; i < poly.length; i++) {
			const d = pointSegmentDistSq(p, poly[i - 1] as Point, poly[i] as Point);
			if (d <= bestDistSq) {
				bestDistSq = d;
				bestId = input.edge.id;
			}
		}
	}
	return bestId;
}
