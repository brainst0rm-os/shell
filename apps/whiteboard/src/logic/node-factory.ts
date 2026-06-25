/**
 * Pure node constructors (9.17.3 Slice C).
 *
 * Every "add to board" gesture in `app.ts` lands here so the renderer
 * stays imperative-but-thin and the defaults are unit-tested without a
 * canvas (same split as `connector.ts`). Each constructor returns a
 * fully-valid `WhiteboardNode` of the requested kind per the frozen
 * Slice-A types — no partials, no post-construction mutation needed.
 *
 * `at` is the canvas-space top-left the node should be placed at (the
 * caller computes it from the viewport centre / pointer). Sizes are the
 * persisted contract: a node never grows from its content, so the
 * defaults below are the box the user sees and drags.
 */

import {
	type EmbeddedNode,
	type FrameNode,
	type GroupNode,
	ImageFit,
	type ImageNode,
	type InkNode,
	NodeKind,
	type ShapeKind,
	type ShapeNode,
	StickyColor,
	type StickyNode,
	TextBlockFormat,
	type TextNode,
} from "../types/node";
import type { InkGeometry } from "./ink";

/** App-local opaque node id — mirrors the `<prefix>_<base36 time>_<rand>`
 *  shape `connector.ts:newEdgeId` (and the other first-party apps) use.
 *  Uniqueness only; the codec keys nodes inside the board entity. */
export function newNodeId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `wbn_${Date.now().toString(36)}_${rand}`;
}

export type CanvasPoint = { x: number; y: number };

const STICKY_SIZE = { width: 180, height: 180 };
const TEXT_SIZE = { width: 220, height: 60 };
const IMAGE_SIZE = { width: 280, height: 200 };
const FRAME_SIZE = { width: 480, height: 360 };
const GROUP_SIZE = { width: 240, height: 180 };
const SHAPE_SIZE = { width: 160, height: 120 };
const EMBED_SIZE = { width: 300, height: 220 };

export function createShapeNode(at: CanvasPoint, shape: ShapeKind): ShapeNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Shape,
		x: at.x,
		y: at.y,
		width: SHAPE_SIZE.width,
		height: SHAPE_SIZE.height,
		shape,
		color: StickyColor.Blue,
	};
}

/** Freehand ink stroke (9.17.9). The box + normalised path come from
 *  `buildInkGeometry` (the captured drag); the stroke colour reuses the
 *  sticky palette so it themes with the rest of the board. */
export function createInkNode(
	geometry: InkGeometry,
	color: StickyColor = StickyColor.Gray,
): InkNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Ink,
		x: geometry.x,
		y: geometry.y,
		width: geometry.width,
		height: geometry.height,
		points: geometry.points,
		color,
	};
}

export function createStickyNode(at: CanvasPoint): StickyNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Sticky,
		x: at.x,
		y: at.y,
		width: STICKY_SIZE.width,
		height: STICKY_SIZE.height,
		text: "",
		color: StickyColor.Yellow,
	};
}

export function createTextNode(at: CanvasPoint): TextNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Text,
		x: at.x,
		y: at.y,
		width: TEXT_SIZE.width,
		height: TEXT_SIZE.height,
		text: "",
		format: TextBlockFormat.Plain,
	};
}

export function createImageNode(at: CanvasPoint, url: string): ImageNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Image,
		x: at.x,
		y: at.y,
		width: IMAGE_SIZE.width,
		height: IMAGE_SIZE.height,
		imageUrl: url,
		fit: ImageFit.Contain,
	};
}

export function createFrameNode(at: CanvasPoint): FrameNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Frame,
		x: at.x,
		y: at.y,
		width: FRAME_SIZE.width,
		height: FRAME_SIZE.height,
		title: "",
		colorHint: null,
	};
}

/** An Embedded node (9.17.4) hosts any vault entity's BP block inside a
 *  whiteboard node. `entityRef` is the `brainstorm://entity/<id>` URL the host
 *  resolves; `entityType` is captured so the providing app's block can be
 *  resolved without a round-trip. The default box is taller than a sticky so a
 *  real block (a task row, a calendar event) has room to paint. */
export function createEmbeddedNode(
	at: CanvasPoint,
	entityRef: string,
	entityType: string,
): EmbeddedNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Embedded,
		x: at.x,
		y: at.y,
		width: EMBED_SIZE.width,
		height: EMBED_SIZE.height,
		entityRef,
		entityType,
	};
}

/** A Group has no independent position — its box is derived from its
 *  members by `groupBounds`. The defaults give it a sane standalone box
 *  for the (degenerate) empty-membership case; the caller normally
 *  reconciles it to `groupBounds` immediately after creation. */
export function createGroupNode(memberIds: readonly string[]): GroupNode {
	return {
		id: newNodeId(),
		kind: NodeKind.Group,
		x: 0,
		y: 0,
		width: GROUP_SIZE.width,
		height: GROUP_SIZE.height,
		memberIds: [...memberIds],
		colorHint: null,
	};
}
