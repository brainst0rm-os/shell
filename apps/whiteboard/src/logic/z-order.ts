/**
 * Z-order / layering (9.17.13) — pure layer-reordering over the node list.
 *
 * Nodes carry an optional `zIndex` that the renderer maps straight to CSS
 * `z-index`. These ops compute a **dense** new z for every node (0..n-1 by
 * stacking order) so repeated reorders never drift into collisions or sparse
 * gaps. Order is read as `(effectiveZ asc, original-index asc)` — the same
 * order the DOM paints — then the selection is moved within it:
 *
 *   - ToFront / ToBack — the whole selection jumps above / below everything,
 *     keeping its internal order.
 *   - Forward / Backward — each selected node steps one layer past an
 *     unselected neighbour (multi-select safe: processed so a selected run
 *     moves as a block, never leap-frogging itself).
 */

import type { WhiteboardNode } from "../types/node";

export enum ZOrderOp {
	ToFront = "to-front",
	Forward = "forward",
	Backward = "backward",
	ToBack = "to-back",
}

function effectiveZ(node: WhiteboardNode): number {
	return node.zIndex ?? 0;
}

/** Stacking order: effective z ascending, ties broken by original index (the
 *  paint order). Bottom-most first, top-most last. */
function stackingOrder(nodes: readonly WhiteboardNode[]): WhiteboardNode[] {
	return nodes
		.map((node, index) => ({ node, index }))
		.sort((a, b) => effectiveZ(a.node) - effectiveZ(b.node) || a.index - b.index)
		.map((e) => e.node);
}

function bubbleForward(order: WhiteboardNode[], sel: ReadonlySet<string>): WhiteboardNode[] {
	const out = [...order];
	for (let i = out.length - 2; i >= 0; i--) {
		const cur = out[i];
		const above = out[i + 1];
		if (cur && above && sel.has(cur.id) && !sel.has(above.id)) {
			out[i] = above;
			out[i + 1] = cur;
		}
	}
	return out;
}

function bubbleBackward(order: WhiteboardNode[], sel: ReadonlySet<string>): WhiteboardNode[] {
	const out = [...order];
	for (let i = 1; i < out.length; i++) {
		const cur = out[i];
		const below = out[i - 1];
		if (cur && below && sel.has(cur.id) && !sel.has(below.id)) {
			out[i] = below;
			out[i - 1] = cur;
		}
	}
	return out;
}

/**
 * New dense zIndex per node id after applying `op` to `selectedIds`. Returns an
 * entry for **every** node (the densify) so the caller writes them all back.
 * An empty selection returns an empty map (no-op).
 */
export function computeZOrder(
	nodes: readonly WhiteboardNode[],
	selectedIds: ReadonlySet<string>,
	op: ZOrderOp,
): Map<string, number> {
	const out = new Map<string, number>();
	if (selectedIds.size === 0) return out;
	const order = stackingOrder(nodes);
	const sel = selectedIds;

	let next: WhiteboardNode[];
	switch (op) {
		case ZOrderOp.ToFront:
			next = [...order.filter((n) => !sel.has(n.id)), ...order.filter((n) => sel.has(n.id))];
			break;
		case ZOrderOp.ToBack:
			next = [...order.filter((n) => sel.has(n.id)), ...order.filter((n) => !sel.has(n.id))];
			break;
		case ZOrderOp.Forward:
			next = bubbleForward(order, sel);
			break;
		case ZOrderOp.Backward:
			next = bubbleBackward(order, sel);
			break;
	}

	next.forEach((node, index) => out.set(node.id, index));
	return out;
}
