/**
 * Connector styling (9.17.16) — pure transforms for the selected edge.
 *
 * Mirrors `node-style.ts`: each function takes the live `edges` array + a
 * target `edgeId` and returns a **new** array with the matching edge patched
 * (timestamp bumped via the injected `now`) and every other edge passed
 * through by reference. The app swaps the array in, persists the one changed
 * edge, and repaints. Keeping these pure makes the routing/arrowhead/dash/
 * colour logic unit-testable without a canvas (same split as `connector.ts`).
 *
 * `exactOptionalPropertyTypes` discipline: `sourceArrowHead === None` and
 * `dashed === false` are the *absent* states, so we delete the key rather
 * than store a falsy value — the codec already omits them on write, and a
 * round-trip must not resurrect them.
 */

import {
	ArrowHead,
	type EdgeColor,
	type EdgePathKind,
	type WhiteboardEdge,
	edgeColorToCss,
} from "../types/edge";

/** Apply `patch` to the edge with `id`, bumping `updatedAt`; all other edges
 *  pass through by reference. Returns the same array reference when `id` is
 *  not found (no-op), so callers can cheaply detect a miss. */
function patchEdge(
	edges: readonly WhiteboardEdge[],
	id: string,
	now: number,
	patch: (edge: WhiteboardEdge) => WhiteboardEdge,
): WhiteboardEdge[] {
	let changed = false;
	const next = edges.map((e) => {
		if (e.id !== id) return e;
		changed = true;
		return { ...patch(e), updatedAt: now };
	});
	return changed ? next : (edges as WhiteboardEdge[]);
}

export function setEdgePathKind(
	edges: readonly WhiteboardEdge[],
	id: string,
	pathKind: EdgePathKind,
	now: number,
): WhiteboardEdge[] {
	return patchEdge(edges, id, now, (e) => ({ ...e, pathKind }));
}

export function setEdgeArrowHead(
	edges: readonly WhiteboardEdge[],
	id: string,
	arrowHead: ArrowHead,
	now: number,
): WhiteboardEdge[] {
	return patchEdge(edges, id, now, (e) => ({ ...e, arrowHead }));
}

/** Toggle a source-end arrowhead (bidirectional connector). `on` adds an
 *  `Arrow` head at the source; off removes the key entirely. */
export function setEdgeBidirectional(
	edges: readonly WhiteboardEdge[],
	id: string,
	on: boolean,
	now: number,
): WhiteboardEdge[] {
	return patchEdge(edges, id, now, (e) => {
		if (on) return { ...e, sourceArrowHead: ArrowHead.Arrow };
		// Off = the key is absent (not a falsy value), so reconstruct without it.
		const { sourceArrowHead: _drop, ...rest } = e;
		return rest;
	});
}

export function setEdgeDashed(
	edges: readonly WhiteboardEdge[],
	id: string,
	dashed: boolean,
	now: number,
): WhiteboardEdge[] {
	return patchEdge(edges, id, now, (e) => {
		if (dashed) return { ...e, dashed: true };
		const { dashed: _drop, ...rest } = e;
		return rest;
	});
}

export function setEdgeColor(
	edges: readonly WhiteboardEdge[],
	id: string,
	color: EdgeColor,
	now: number,
): WhiteboardEdge[] {
	const css = edgeColorToCss(color);
	return patchEdge(edges, id, now, (e) => ({ ...e, colorHint: css }));
}

/** True when the edge draws a source-end arrowhead (drives the menu check). */
export function isBidirectional(edge: WhiteboardEdge): boolean {
	return edge.sourceArrowHead !== undefined && edge.sourceArrowHead !== ArrowHead.None;
}
