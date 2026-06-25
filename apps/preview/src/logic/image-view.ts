/**
 * Image-view math — 9.20.2.
 *
 * Pure zoom / pan / fit-mode geometry, separated from the DOM renderer so
 * the whole interaction model is unit-testable without a browser. The
 * renderer owns a `<img>` inside a clipping viewport and applies the
 * `ViewState` as a single `transform: translate(tx,ty) scale(scale)`
 * (GPU-only — per [[feedback_animate_transform_not_width]]).
 *
 * Coordinate frame: the image is centered in the viewport; `tx` / `ty` are
 * pixel offsets of the image centre from the viewport centre. Anchors
 * passed to `zoomAt` are screen pixels measured from the viewport centre,
 * so the math is symmetric and origin-free.
 */

export enum FitMode {
	/** Scale so the whole image is visible; never upscales past 1× so
	 *  tiny images stay crisp (Quick Look behaviour). */
	Fit = "fit",
	/** 1 device-independent pixel per image pixel. */
	Actual = "actual",
	/** Cover the viewport, cropping the overflowing axis. */
	Fill = "fill",
	/** Set by manual wheel / drag / pinch — the Fit control skips this
	 *  when cycling but the toolbar shows the live percentage. */
	Custom = "custom",
}

export type Size = { w: number; h: number };

export type ViewState = {
	scale: number;
	tx: number;
	ty: number;
	mode: FitMode;
};

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 40;

/** Multiplicative step for a single keyboard / button zoom tick. */
export const ZOOM_STEP = 1.25;

export function clampScale(scale: number): number {
	if (Number.isNaN(scale)) return MIN_SCALE;
	// Math.min/max naturally map +Infinity→MAX, -Infinity / ≤0 → MIN.
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The scale that satisfies `mode` for the given natural + viewport size.
 *  Degenerate sizes fall back to 1 so a zero-dimension image (decode not
 *  finished, SVG with no intrinsic size) doesn't divide-by-zero. */
export function baseScale(natural: Size, viewport: Size, mode: FitMode): number {
	if (natural.w <= 0 || natural.h <= 0 || viewport.w <= 0 || viewport.h <= 0) {
		return 1;
	}
	const sx = viewport.w / natural.w;
	const sy = viewport.h / natural.h;
	switch (mode) {
		case FitMode.Actual:
			return 1;
		case FitMode.Fill:
			return clampScale(Math.max(sx, sy));
		case FitMode.Custom:
		case FitMode.Fit:
			// Don't upscale on Fit — a 32px icon shouldn't blur to fill a
			// 4K pane. Large images shrink to fit.
			return clampScale(Math.min(sx, sy, 1));
	}
}

/** A `ViewState` snapped to a fit mode: image centred, scale derived. */
export function viewForMode(natural: Size, viewport: Size, mode: FitMode): ViewState {
	const resolved = mode === FitMode.Custom ? FitMode.Fit : mode;
	return { scale: baseScale(natural, viewport, resolved), tx: 0, ty: 0, mode: resolved };
}

/** Clamp pan so the image can't be dragged off into empty space. When the
 *  scaled image is smaller than the viewport on an axis it's force-centred
 *  on that axis; when larger, pan is bounded to the overscan. */
export function clampPan(state: ViewState, natural: Size, viewport: Size): ViewState {
	const dispW = natural.w * state.scale;
	const dispH = natural.h * state.scale;
	const maxX = Math.max(0, (dispW - viewport.w) / 2);
	const maxY = Math.max(0, (dispH - viewport.h) / 2);
	const tx = clamp(state.tx, -maxX, maxX);
	const ty = clamp(state.ty, -maxY, maxY);
	if (tx === state.tx && ty === state.ty) return state;
	return { ...state, tx, ty };
}

/** Zoom by `factor` keeping the image point under `anchor` stationary.
 *  `anchor` is in screen pixels relative to the viewport centre. */
export function zoomAt(
	state: ViewState,
	factor: number,
	anchor: { x: number; y: number },
	natural: Size,
	viewport: Size,
): ViewState {
	const nextScale = clampScale(state.scale * factor);
	if (nextScale === state.scale) return state;
	const ratio = nextScale / state.scale;
	// Keep the point under the cursor fixed: p = t + local*scale, local is
	// invariant, so t' = p - (p - t) * (scale'/scale).
	const tx = anchor.x - (anchor.x - state.tx) * ratio;
	const ty = anchor.y - (anchor.y - state.ty) * ratio;
	return clampPan({ scale: nextScale, tx, ty, mode: FitMode.Custom }, natural, viewport);
}

/** Apply a relative drag delta (screen px) to the pan. */
export function panBy(
	state: ViewState,
	dx: number,
	dy: number,
	natural: Size,
	viewport: Size,
): ViewState {
	return clampPan(
		{ scale: state.scale, tx: state.tx + dx, ty: state.ty + dy, mode: FitMode.Custom },
		natural,
		viewport,
	);
}

/** Fit → Actual → Fill → Fit. Custom is treated as Fit's predecessor so
 *  the first press after a manual zoom snaps back to Fit. */
export function cycleFitMode(mode: FitMode): FitMode {
	switch (mode) {
		case FitMode.Fit:
			return FitMode.Actual;
		case FitMode.Actual:
			return FitMode.Fill;
		default:
			return FitMode.Fit;
	}
}

/** Double-click / `Z` toggle: if we're near actual size, snap back to
 *  Fit (centred); otherwise jump to 1× anchored on the click point. */
export function toggleActual(
	state: ViewState,
	anchor: { x: number; y: number },
	natural: Size,
	viewport: Size,
): ViewState {
	const atActual = Math.abs(state.scale - 1) < 0.01;
	if (atActual) return viewForMode(natural, viewport, FitMode.Fit);
	return zoomAt(state, 1 / state.scale, anchor, natural, viewport);
}

export function percentLabel(scale: number): string {
	return `${Math.round(scale * 100)}%`;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
