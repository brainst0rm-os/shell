/**
 * Compute the canvas-coordinate position of a handle on a node.
 *
 * **Long-term keystone** per [[preview-drop-pattern]] — survives the
 * SVG → Pixi renderer swap at 9.17.5 unchanged because it's pure
 * geometry over the bbox + side enum.
 */

import { HandleSide } from "../types/edge";
import type { WhiteboardNode } from "../types/node";

export type Point = { x: number; y: number };

/** Returns the centre point of the named handle on the given node. The
 *  handle sits on the midpoint of the node's edge. */
export function positionForHandle(node: WhiteboardNode, side: HandleSide): Point {
	const cx = node.x + node.width / 2;
	const cy = node.y + node.height / 2;
	switch (side) {
		case HandleSide.Top:
			return { x: cx, y: node.y };
		case HandleSide.Right:
			return { x: node.x + node.width, y: cy };
		case HandleSide.Bottom:
			return { x: cx, y: node.y + node.height };
		case HandleSide.Left:
			return { x: node.x, y: cy };
	}
}

/** Direction the handle's normal points outward — used by the bezier-
 *  path tangent + the arrowhead orientation. */
export function normalForSide(side: HandleSide): Point {
	switch (side) {
		case HandleSide.Top:
			return { x: 0, y: -1 };
		case HandleSide.Right:
			return { x: 1, y: 0 };
		case HandleSide.Bottom:
			return { x: 0, y: 1 };
		case HandleSide.Left:
			return { x: -1, y: 0 };
	}
}
