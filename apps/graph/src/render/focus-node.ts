/**
 * Camera framing math for "centre this node" — a cross-app `intent.open`
 * targeting a vault entity that's a graph vertex. Pure + framework-free
 * so it's unit-tested without a canvas; `app.ts` wraps it with the live
 * zoom bounds and applies the result to `state.transform` (the rAF render
 * loop repaints from there).
 *
 * World→screen is `screenX = worldX*k + tx` (same as the renderer and
 * `fitTransformToContent`), so to land `node` at the viewBox centre:
 *   tx = viewWidth/2  - nodeX*k
 *   ty = viewHeight/2 - nodeY*k
 */

import type { CameraTransform } from "./svg-renderer";

export function focusNodeTransform(
	node: { x: number; y: number },
	view: { width: number; height: number },
	k: number,
	zoom: { min: number; max: number },
): CameraTransform {
	const kk = Math.max(zoom.min, Math.min(zoom.max, k));
	return {
		k: kk,
		tx: view.width / 2 - node.x * kk,
		ty: view.height / 2 - node.y * kk,
	};
}
