/**
 * Edge batching — the pure geometry layer behind the Pixi edge draw
 * (iteration 9.13.15, WebGL instanced-draw / batching loop).
 *
 * **The problem this solves.** The first-cut `drawEdges` issued one
 * `Graphics.stroke({...})` per edge and one `Graphics.fill({...})` per
 * arrowhead. In Pixi 8 every `stroke()`/`fill()` call closes off a
 * sub-geometry with its OWN style, so `N` edges produced `N` (and with
 * arrows, up to `2N`) style transitions in the geometry instruction
 * stream — the batcher can't coalesce across a style change, so a dense
 * graph fragmented into hundreds of micro-draws and the per-frame
 * tessellation/upload cost grew linearly with edge count.
 *
 * **The fix.** Edges that share a *render style* — the same tint and the
 * same quantised alpha — also share a single GL draw. We bucket every
 * edge by `(tint, alphaBucket)`, accumulate all its line segments into
 * ONE path, and stroke that path ONCE per bucket. Arrowheads bucket the
 * same way and fill once per bucket. Distinct styles in a typical vault
 * graph number in the low tens (≈ one per edge-reason category × a few
 * alpha levels), so `2N` style transitions collapse to `O(distinct
 * styles)` — flat in edge count.
 *
 * This module is intentionally **pure**: it takes resolved edge geometry
 * + style and returns the batch plan (segment + triangle coordinate
 * buffers, grouped). It does no Pixi calls and no DOM work, so it's
 * unit-testable under the `node` test environment and benchable without a
 * GPU. `pixi-renderer.ts` consumes the plan and replays it onto the
 * single edge `Graphics`.
 */

import { ARROW_HIDE_BELOW_K } from "./svg-renderer";

/** A resolved edge ready to batch: world-space endpoints + node radii +
 *  its already-resolved tint/alpha. The renderer derives this from the
 *  scene's `RenderEdge` + the layout positions; keeping it a plain record
 *  is what makes the batcher pure and testable. */
export type EdgeGeometryInput = {
	/** Source/destination node CENTRES in world space. */
	sx: number;
	sy: number;
	dx: number;
	dy: number;
	/** Node radii — the segment is trimmed off each disc so it doesn't
	 *  bury under the node. */
	sourceRadius: number;
	destRadius: number;
	/** 24-bit RGB tint (already resolved from the colour string). */
	tint: number;
	/** Effective 0..1 alpha (edge alpha × focus × colour-channel alpha). */
	alpha: number;
};

/** One stroke batch: every segment that shares `tint` + the quantised
 *  `alpha`, flattened into a single `[x1,y1,x2,y2, x1,y1,x2,y2, …]`
 *  coordinate buffer. The renderer walks it `moveTo/lineTo` then issues a
 *  single `stroke({ width, color: tint, alpha })`. */
export type EdgeStrokeBatch = {
	tint: number;
	alpha: number;
	/** Flat segment coords: 4 numbers (x1,y1,x2,y2) per segment. */
	segments: number[];
};

/** One fill batch: every arrowhead triangle that shares a render style,
 *  flattened into `[ax,ay, bx,by, cx,cy, …]` (3 vertices per triangle).
 *  Filled once per batch. */
export type EdgeFillBatch = {
	tint: number;
	alpha: number;
	/** Flat triangle coords: 6 numbers (3 × x,y) per triangle. */
	triangles: number[];
};

export type EdgeBatchPlan = {
	strokes: EdgeStrokeBatch[];
	fills: EdgeFillBatch[];
	/** Diagnostics for the perf guard: how many edges were laid out and how
	 *  many distinct GL draws the plan collapses to (one per stroke batch +
	 *  one per fill batch). The whole point of batching is that `drawCalls`
	 *  stays flat as `edgeCount` grows. */
	edgeCount: number;
	drawCalls: number;
};

/** Arrowhead size in world units — matches the first-cut renderer. */
const ARROW_HEAD_LEN = 5;
const ARROW_HEAD_WID = 3.2;
/** Extra trim at the destination when the arrowhead shows, so the line
 *  stops short of the head instead of poking through it. */
const ARROW_TRIM = 5;
/** Base trim off each node disc (px world units). */
const DISC_TRIM = 3;

/** Quantise alpha to a small set of buckets so near-identical fades share
 *  one batch instead of fragmenting into a distinct style per edge. 32
 *  steps (≈ 0.03 granularity) is finer than the eye resolves on a thin
 *  line yet keeps the distinct-style count bounded. */
const ALPHA_STEPS = 32;

export function quantiseAlpha(alpha: number): number {
	const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
	return Math.round(clamped * ALPHA_STEPS) / ALPHA_STEPS;
}

/** A stable bucket key for a `(tint, quantised-alpha)` pair. Tint is
 *  24-bit, so shifting the alpha step above it keeps the key collision-free
 *  and integer (fast Map key). */
function bucketKey(tint: number, alphaStep: number): number {
	return tint * (ALPHA_STEPS + 1) + alphaStep;
}

export type BuildEdgeBatchesOptions = {
	/** Camera zoom — drives the arrowhead LOD + the extra destination trim,
	 *  exactly as the first-cut renderer did. */
	zoom: number;
	/** User "Arrows" toggle. */
	showArrows: boolean;
};

/**
 * Group resolved edge geometry into stroke + fill batches.
 *
 * Each edge contributes one trimmed line segment to its `(tint, alpha)`
 * stroke bucket. When arrows show (zoom ≥ `ARROW_HIDE_BELOW_K` AND the
 * toggle is on), it also contributes one arrowhead triangle to the
 * matching fill bucket. Degenerate edges (endpoints so close the trims
 * cross) are dropped — they'd render as a zero-or-negative-length spike.
 */
export function buildEdgeBatches(
	edges: readonly EdgeGeometryInput[],
	options: BuildEdgeBatchesOptions,
): EdgeBatchPlan {
	const showArrows = options.showArrows && options.zoom >= ARROW_HIDE_BELOW_K;
	const strokeBuckets = new Map<number, EdgeStrokeBatch>();
	const fillBuckets = new Map<number, EdgeFillBatch>();
	let edgeCount = 0;

	for (const edge of edges) {
		const ddx = edge.dx - edge.sx;
		const ddy = edge.dy - edge.sy;
		const dist = Math.hypot(ddx, ddy) || 1;
		const ux = ddx / dist;
		const uy = ddy / dist;
		const sourceTrim = edge.sourceRadius + DISC_TRIM;
		const destTrim = edge.destRadius + DISC_TRIM + (showArrows ? ARROW_TRIM : 0);
		const x1 = edge.sx + ux * sourceTrim;
		const y1 = edge.sy + uy * sourceTrim;
		const x2 = edge.dx - ux * destTrim;
		const y2 = edge.dy - uy * destTrim;
		// Skip an edge whose trims cross (nodes overlap / are too close): the
		// remaining segment points backwards, which would draw a spurious
		// spike. Mirrors the first-cut renderer's dot-product guard.
		if ((x2 - x1) * ux + (y2 - y1) * uy <= 0) continue;

		edgeCount += 1;
		const alphaStep = Math.round(quantiseAlpha(edge.alpha) * ALPHA_STEPS);
		const alpha = alphaStep / ALPHA_STEPS;
		const key = bucketKey(edge.tint, alphaStep);

		let stroke = strokeBuckets.get(key);
		if (!stroke) {
			stroke = { tint: edge.tint, alpha, segments: [] };
			strokeBuckets.set(key, stroke);
		}
		stroke.segments.push(x1, y1, x2, y2);

		if (showArrows) {
			// Perpendicular to the edge direction → the two base vertices of
			// the head triangle. Tip is the trimmed destination end.
			const px = -uy;
			const py = ux;
			const baseX = x2 - ux * ARROW_HEAD_LEN;
			const baseY = y2 - uy * ARROW_HEAD_LEN;
			let fill = fillBuckets.get(key);
			if (!fill) {
				fill = { tint: edge.tint, alpha, triangles: [] };
				fillBuckets.set(key, fill);
			}
			fill.triangles.push(
				x2,
				y2,
				baseX + px * ARROW_HEAD_WID,
				baseY + py * ARROW_HEAD_WID,
				baseX - px * ARROW_HEAD_WID,
				baseY - py * ARROW_HEAD_WID,
			);
		}
	}

	const strokes = [...strokeBuckets.values()];
	const fills = [...fillBuckets.values()];
	return {
		strokes,
		fills,
		edgeCount,
		drawCalls: strokes.length + fills.length,
	};
}
