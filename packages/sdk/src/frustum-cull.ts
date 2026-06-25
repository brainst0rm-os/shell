/**
 * Frustum culling for canvas renderers (Graph nodes/edges, Whiteboard
 * connectors). Both apps run an O(nodes + edges) per-frame sync pass; on
 * a large vault zoomed in to one cluster, most of that work paints pixels
 * nobody can see. This module computes the visible world rectangle from a
 * camera transform + viewport size and exposes cheap circle-vs-rect and
 * segment-vs-rect predicates so the renderer skips everything off-screen
 * (plus a screen-space margin so a pan doesn't pop sprites in a frame
 * late). Pure: no DOM, no Pixi — fully unit-testable and benched against
 * the 16.6 ms frame budget.
 *
 * Extracted to the SDK at copy two: Graph (9.13.5) and Whiteboard
 * (9.17.5) had byte-identical implementations. One source so the cull
 * math, fail-open guard, and margin behaviour stay identical everywhere.
 */

/** Camera transform — `k` is the zoom level, `tx`/`ty` the world
 *  translation. Identity is `{ k: 1, tx: 0, ty: 0 }`. Screen→world is
 *  `world = (screen - t) / k` (the inverse of `screen = world * k + t`). */
export type CameraTransform = {
	k: number;
	tx: number;
	ty: number;
};

/** A world-space axis-aligned rectangle. `min*` ≤ `max*` always (the
 *  camera scale `k` is clamped positive before inversion). */
export type ViewBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

/** Screen-space padding (CSS px) added on every side of the viewport
 *  before inverting to world space. A node up to this far off-screen
 *  still gets a primed sprite, so panning reveals it instantly instead
 *  of popping it in a frame late. ~1.5 node-rows at default zoom. */
export const DEFAULT_CULL_MARGIN_PX = 220;

/** Smallest camera scale we invert through. `k` can momentarily reach 0
 *  during a zoom-to-fit on an empty scene; dividing by it would yield
 *  ±Infinity bounds (everything "visible" — safe but pointless) or NaN.
 *  Clamping keeps the rect finite. */
const MIN_K = 1e-4;

/** Collapse a signed `-0` to `+0`. `(-0 - 0) / k` is `-0`, which is
 *  mathematically equal to `0` but trips `Object.is`-based equality in
 *  consumers/tests. Bounds are an interval, not a direction — the sign
 *  of a zero coordinate carries no meaning here. */
const unsignZero = (n: number): number => (n === 0 ? 0 : n);

/**
 * Is the viewport size trustworthy enough to cull against? A non-finite
 * or non-positive width/height means we don't actually know what's on
 * screen yet (pre-layout frame, a stale cached size, a detached canvas).
 * Culling on a bad viewport silently drops visible content — the icons
 * regression. When this returns false the renderer must **fail open**
 * and draw everything; the perf cull only engages once the size is real.
 */
export function viewportUsable(viewWidth: number, viewHeight: number): boolean {
	return (
		Number.isFinite(viewWidth) && Number.isFinite(viewHeight) && viewWidth > 0 && viewHeight > 0
	);
}

/**
 * Invert the screen viewport `[0, viewWidth] × [0, viewHeight]`, grown
 * by `marginPx` on each side, into world coordinates under `transform`.
 */
export function computeViewBounds(
	transform: CameraTransform,
	viewWidth: number,
	viewHeight: number,
	marginPx: number = DEFAULT_CULL_MARGIN_PX,
): ViewBounds {
	const k = Math.max(MIN_K, transform.k);
	const m = Math.max(0, marginPx);
	return {
		minX: unsignZero((-m - transform.tx) / k),
		maxX: unsignZero((viewWidth + m - transform.tx) / k),
		minY: unsignZero((-m - transform.ty) / k),
		maxY: unsignZero((viewHeight + m - transform.ty) / k),
	};
}

/**
 * Circle-vs-rectangle overlap. A node at `(x, y)` with world `radius`
 * is visible iff its disc touches the bounds rect. Conservative on the
 * cheap side — uses the disc's bounding box, not the exact disc, so a
 * corner-grazing node may be kept; it never culls a node that is
 * actually on screen.
 */
export function nodeInView(x: number, y: number, radius: number, b: ViewBounds): boolean {
	return (
		x + radius >= b.minX && x - radius <= b.maxX && y + radius >= b.minY && y - radius <= b.maxY
	);
}

/**
 * Segment-vs-rectangle overlap, used to cull edges. Tests the segment's
 * bounding box against the view rect: cheap (4 comparisons), and a
 * strict superset of true segment-rect intersection — so an edge whose
 * box clips the viewport but whose line misses it is kept (drawn, then
 * trivially clipped by the GPU). Never culls an edge that crosses the
 * screen. Exact line-rect clipping would cost more CPU than the handful
 * of false-positive `lineTo` calls it would save.
 */
export function segmentInView(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	b: ViewBounds,
): boolean {
	// Zero-alloc bounds: this runs once per edge per frame, so no per-call
	// closures — `Math.min/max` are intrinsics.
	return (
		Math.max(x1, x2) >= b.minX &&
		Math.min(x1, x2) <= b.maxX &&
		Math.max(y1, y2) >= b.minY &&
		Math.min(y1, y2) <= b.maxY
	);
}
