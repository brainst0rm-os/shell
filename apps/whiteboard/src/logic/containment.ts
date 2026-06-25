/**
 * Pure containment / geometry helpers for the whiteboard scene.
 *
 * **Long-term keystone** per [[preview-drop-pattern]] — survives the
 * SVG → Pixi renderer swap at 9.17.5 unchanged because it is pure
 * geometry over node bounding boxes. No DOM, no Pixi, no mutation.
 *
 * Two membership models coexist (OQ-WB-4, resolved in Slice A):
 *
 *   - **Frame = spatial dynamic membership.** A node is "in" a frame
 *     when its bounding box is fully inside the frame's content region
 *     at query time. There is no stored parent pointer — the wire
 *     contract is unchanged. Dragging a frame moves the frame plus the
 *     nodes contained in it *captured once at drag start* (not
 *     continuously re-evaluated mid-drag).
 *
 *   - **Group = explicit `memberIds`.** Membership is stored, stable,
 *     and non-spatial. Selecting or dragging any member affects every
 *     member. v1 is flat: a node belongs to at most one group, and a
 *     group's box is the union AABB of its resolved members.
 */

import {
	type FrameNode,
	type GroupNode,
	type WhiteboardNode,
	isFrame,
	isGroup,
} from "../types/node";

export type Bounds = { x: number; y: number; width: number; height: number };

export function nodeBounds(n: WhiteboardNode): Bounds {
	return { x: n.x, y: n.y, width: n.width, height: n.height };
}

/** True when `inner` lies entirely within `outer`. Edges are inclusive,
 *  so an inner box flush against an outer edge still counts as contained. */
export function containsBounds(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/** True when `a` and `b` overlap. Edge-only touching does not count as
 *  an intersection (strict on both axes), keeping it the complement of a
 *  separating-axis gap rather than of `containsBounds`. */
export function intersectsBounds(a: Bounds, b: Bounds): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Nodes fully inside the frame's content region. Excludes the frame
 * itself, every other Frame node, and Group container nodes — only
 * leaf scenery is considered "framed". Membership is spatial and
 * evaluated against `all` as passed.
 */
export function nodesWithinFrame(
	frame: FrameNode,
	all: readonly WhiteboardNode[],
): WhiteboardNode[] {
	const region = nodeBounds(frame);
	const result: WhiteboardNode[] = [];
	for (const n of all) {
		if (n.id === frame.id || isFrame(n) || isGroup(n)) continue;
		if (containsBounds(region, nodeBounds(n))) result.push(n);
	}
	return result;
}

/** Union AABB of a group's resolved members, or `null` when no member
 *  id resolves to a node in `all` (an empty or fully-dangling group). */
export function groupBounds(group: GroupNode, all: readonly WhiteboardNode[]): Bounds | null {
	const byId = new Map(all.map((n) => [n.id, n] as const));
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let resolved = false;
	for (const id of group.memberIds) {
		const m = byId.get(id);
		if (!m) continue;
		resolved = true;
		minX = Math.min(minX, m.x);
		minY = Math.min(minY, m.y);
		maxX = Math.max(maxX, m.x + m.width);
		maxY = Math.max(maxY, m.y + m.height);
	}
	if (!resolved) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * New positions for the named ids, each offset by `(dx, dy)`. Pure:
 * `all` is read, never mutated, and ids absent from `all` are skipped.
 */
export function translateNodes(
	ids: ReadonlySet<string>,
	dx: number,
	dy: number,
	all: readonly WhiteboardNode[],
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	for (const n of all) {
		if (ids.has(n.id)) out.set(n.id, { x: n.x + dx, y: n.y + dy });
	}
	return out;
}

function groupOf(nodeId: string, all: readonly WhiteboardNode[]): GroupNode | null {
	for (const n of all) {
		if (isGroup(n) && n.memberIds.includes(nodeId)) return n;
	}
	return null;
}

/**
 * The id-set that moves when `node` is dragged:
 *   - a group member → every member of its group (the group container
 *     id is not part of the set; it has no independent position);
 *   - a Frame → the frame id plus every spatially-contained node;
 *   - otherwise → just the node.
 */
export function resolveDragSet(
	node: WhiteboardNode,
	all: readonly WhiteboardNode[],
): ReadonlySet<string> {
	const group = groupOf(node.id, all);
	if (group) return new Set(group.memberIds);
	if (isFrame(node)) {
		const ids = new Set<string>([node.id]);
		for (const n of nodesWithinFrame(node, all)) ids.add(n.id);
		return ids;
	}
	return new Set([node.id]);
}

/**
 * Frame + every node within it at call time, all offset by `(dx, dy)`.
 * Membership is captured once here (the caller snapshots at drag start);
 * it is not re-evaluated as the frame moves. Outsider nodes are absent
 * from the result and therefore left untouched by the caller.
 */
export function frameMoveDelta(
	frame: FrameNode,
	dx: number,
	dy: number,
	all: readonly WhiteboardNode[],
): Map<string, { x: number; y: number }> {
	const ids = new Set<string>([frame.id]);
	for (const n of nodesWithinFrame(frame, all)) ids.add(n.id);
	return translateNodes(ids, dx, dy, all);
}
