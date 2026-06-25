/**
 * Image rotation math — 9.20.8.
 *
 * Pure 90°-step rotation state, separated from the DOM renderer like the
 * zoom/pan geometry in `image-view.ts`. Rotation is per-device view chrome
 * (Quick-Look style, reset per file), applied as an extra `rotate(deg)` on the
 * image's GPU transform. At a quarter turn (90° / 270°) the displayed bounding
 * box swaps width/height, so `effectiveSize` feeds the rotation-aware box into
 * the existing fit / pan math — the renderer passes `effectiveSize(natural,
 * angle)` wherever it used to pass the raw natural size.
 */

import type { Size } from "./image-view";

export enum RotationDirection {
	Left = "left",
	Right = "right",
}

/** The four legal display angles (clockwise degrees). */
export type Angle = 0 | 90 | 180 | 270;

/** Snap any degree value to the nearest legal `Angle`, wrapped into [0, 360).
 *  Tolerates negatives and >360 (e.g. accumulated rotation). */
export function normalizeAngle(deg: number): Angle {
	const wrapped = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
	return wrapped as Angle;
}

/** Rotate one quarter turn: Right is +90° (clockwise), Left is −90°. */
export function rotateBy(angle: number, dir: RotationDirection): Angle {
	return normalizeAngle(angle + (dir === RotationDirection.Right ? 90 : -90));
}

/** True at 90° / 270° — the turns that swap the displayed width and height. */
export function isQuarterTurned(angle: number): boolean {
	return normalizeAngle(angle) % 180 !== 0;
}

/** The displayed bounding box after rotating `natural` by `angle`: identical
 *  at 0° / 180°, swapped at 90° / 270°. */
export function effectiveSize(natural: Size, angle: number): Size {
	return isQuarterTurned(angle) ? { w: natural.h, h: natural.w } : { w: natural.w, h: natural.h };
}

/** Flip axes (9.20.8 image controls). A flip mirrors the image about an axis
 *  in image-local space; it never changes the bounding box (`scale(±1)`), so
 *  fit / pan math is unaffected — unlike a quarter-turn rotation. */
export enum FlipAxis {
	Horizontal = "horizontal",
	Vertical = "vertical",
}

/** The `scale()` factors for a flip state. `Horizontal` mirrors across the
 *  vertical axis (`sx = -1`); `Vertical` mirrors across the horizontal axis
 *  (`sy = -1`). Both off → identity `{1, 1}`. */
export function flipScaleFactors(flipH: boolean, flipV: boolean): { sx: 1 | -1; sy: 1 | -1 } {
	return { sx: flipH ? -1 : 1, sy: flipV ? -1 : 1 };
}
