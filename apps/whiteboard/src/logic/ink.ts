/**
 * Freehand ink geometry (9.17.9) — pure helpers for the pen tool.
 *
 * The pen captures raw canvas-space points during a drag; this module turns
 * them into a node box + a path normalised to a `0..100` square. Storing the
 * path in normalised space (rather than absolute canvas px) lets the SVG
 * render in a fixed `0 0 100 100` viewBox with `preserveAspectRatio="none"`,
 * so resizing the node box stretches the stroke with it — the same render
 * trick the SVG primitive shapes (9.17.10) use. Pure + canvas-free so the
 * bbox / normalisation math is unit-tested without a pointer.
 */

import type { Point } from "./handle-positions";

/** Normalised stroke point, each axis in `[0, 100]` within the node box. */
export type InkPoint = { x: number; y: number };

/** A captured stroke needs at least this many points to become a node (a
 *  single tap isn't a stroke — it'd be an invisible zero-length box). */
export const MIN_INK_POINTS = 2;

/** Canvas-px padding around the stroke's tight bbox so the stroke width and
 *  end-caps aren't clipped at the node edge. */
const INK_PAD = 8;

export type InkGeometry = {
	x: number;
	y: number;
	width: number;
	height: number;
	points: InkPoint[];
};

/** Build the node box + normalised path from raw canvas points, or `null`
 *  when the gesture is too short to be a stroke. The box is the points' bbox
 *  padded by `INK_PAD`; each point maps into the padded box as `0..100`. */
export function buildInkGeometry(raw: readonly Point[]): InkGeometry | null {
	if (raw.length < MIN_INK_POINTS) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of raw) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const x = minX - INK_PAD;
	const y = minY - INK_PAD;
	const width = maxX - minX + INK_PAD * 2;
	const height = maxY - minY + INK_PAD * 2;
	const points = raw.map((p) => ({
		x: clamp01to100(((p.x - x) / width) * 100),
		y: clamp01to100(((p.y - y) / height) * 100),
	}));
	return { x, y, width, height, points };
}

function clamp01to100(v: number): number {
	return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Serialise a normalised path to an SVG `points` attribute (`x,y x,y …`),
 *  rounded to 2dp so the stored / rendered string stays compact. */
export function inkPointsAttr(points: readonly InkPoint[]): string {
	return points.map((p) => `${round2(p.x)},${round2(p.y)}`).join(" ");
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/** Validate + coerce a stored points array (codec read path). Drops any
 *  non-finite entry; returns `null` when fewer than `MIN_INK_POINTS` survive
 *  so a malformed row falls back rather than rendering a broken stroke. */
export function coerceInkPoints(raw: unknown): InkPoint[] | null {
	if (!Array.isArray(raw)) return null;
	const out: InkPoint[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const p = entry as { x?: unknown; y?: unknown };
		if (
			typeof p.x === "number" &&
			Number.isFinite(p.x) &&
			typeof p.y === "number" &&
			Number.isFinite(p.y)
		) {
			out.push({ x: p.x, y: p.y });
		}
	}
	return out.length >= MIN_INK_POINTS ? out : null;
}
