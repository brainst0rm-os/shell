/**
 * Connector authoring (9.17.6) — the pure half.
 *
 * Drag-from-handle is the interaction; the DOM/pointer wiring lives in
 * `app.ts`, but every decision it makes is a pure function here so the
 * geometry + edge construction are unit-tested without a canvas (same
 * split as `handle-positions` / `edge-path`). The Pixi swap (9.17.5)
 * reuses these unchanged.
 */

import { ArrowHead, EdgePathKind, HANDLE_SIDES, type HandleSide } from "../types/edge";
import type { WhiteboardEdge } from "../types/edge";
import type { WhiteboardNode } from "../types/node";
import { type Point, positionForHandle } from "./handle-positions";

/** The handle whose anchor point is closest to `point` (canvas
 *  coordinates). Used on connector-drop to pick the dest side so the
 *  edge meets the target where the user aimed, not always its centre.
 *  Squared distance — no `sqrt`, ordering is identical. Ties resolve to
 *  the earlier `HANDLE_SIDES` entry (top → right → bottom → left). */
export function nearestHandleSide(node: WhiteboardNode, point: Point): HandleSide {
	let best: HandleSide = HANDLE_SIDES[0] as HandleSide;
	let bestD = Number.POSITIVE_INFINITY;
	for (const side of HANDLE_SIDES) {
		const p = positionForHandle(node, side);
		const dx = p.x - point.x;
		const dy = p.y - point.y;
		const d = dx * dx + dy * dy;
		if (d < bestD) {
			bestD = d;
			best = side;
		}
	}
	return best;
}

/** App-local opaque edge id — mirrors the `<prefix>_<base36 time>_<rand>`
 *  shape the other first-party apps use (Notes `n_…`, code-editor
 *  `cf_…`). Uniqueness only; the codec keys it `whiteboard-edge:<id>`. */
export function newEdgeId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `wbe_${Date.now().toString(36)}_${rand}`;
}

export type ConnectorEnd = { nodeId: string; side: HandleSide };

/** Build a persistable `WhiteboardEdge` from a completed connector
 *  drag. Defaults match the demo authoring conventions: a `Step` path
 *  (the cleanest for ad-hoc diagramming) with an `Arrow` head at the
 *  dest end, no label / colour. `now` is injected so the row's
 *  timestamps are deterministic in tests. */
export function buildConnectorEdge(args: {
	whiteboardId: string;
	from: ConnectorEnd;
	to: ConnectorEnd;
	now: number;
	id?: string;
}): WhiteboardEdge {
	return {
		id: args.id ?? newEdgeId(),
		whiteboardId: args.whiteboardId,
		sourceNodeId: args.from.nodeId,
		sourceHandle: args.from.side,
		destNodeId: args.to.nodeId,
		destHandle: args.to.side,
		pathKind: EdgePathKind.Step,
		arrowHead: ArrowHead.Arrow,
		label: null,
		colorHint: null,
		createdAt: args.now,
		updatedAt: args.now,
	};
}

/** A connector drop is only a real edge when it lands on a *different*
 *  node (self-edges are a v2 affordance — they need a routed loop the
 *  step/bezier math doesn't draw cleanly) and the source/dest aren't
 *  already directly connected in the same direction (no duplicate
 *  parallel edge from one authoring gesture). */
export function isValidConnectorDrop(
	from: ConnectorEnd,
	toNodeId: string,
	existing: readonly WhiteboardEdge[],
): boolean {
	if (toNodeId === from.nodeId) return false;
	return !existing.some((e) => e.sourceNodeId === from.nodeId && e.destNodeId === toNodeId);
}
