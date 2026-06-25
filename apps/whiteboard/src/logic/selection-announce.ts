/**
 * Pure selection-summary for the canvas keyboard a11y announcements
 * (KBN-A-whiteboard, 12.4). The whiteboard's nodes are focusable DOM
 * elements, so Tab already moves between them and the existing nudge /
 * delete / edit chords act on the selection — the missing piece is that a
 * keyboard / screen-reader user gets nothing *spoken* when focus moves or a
 * node nudges. `app.ts` turns this summary into a localized live-region
 * string; the framework-free shape is unit-tested without a DOM.
 */

import { NodeKind, type WhiteboardNode } from "../types/node";

export type SelectionSummary =
	| { readonly kind: "none" }
	| {
			readonly kind: "single";
			/** The node's own text/title, trimmed; empty when it has none (the
			 *  caller substitutes a per-kind word so the node is never anonymous). */
			readonly label: string;
			readonly nodeKind: NodeKind;
			readonly x: number;
			readonly y: number;
	  }
	| { readonly kind: "multi"; readonly count: number };

/**
 * Whether a node receiving focus should (re)select. Keyboard focus single-
 * selects an *unselected* node (Tab-into), but must NOT fire when focus lands
 * on a node that's ALREADY part of the current selection — otherwise the
 * programmatic `focusSelectedNode()` after a multi-node nudge / duplicate
 * collapses the whole selection down to that one node (KBN-A-whiteboard bug).
 */
export function shouldSelectOnFocus(selectedIds: ReadonlySet<string>, nodeId: string): boolean {
	return !selectedIds.has(nodeId);
}

/** A node's own label text (sticky / text body, frame title), trimmed.
 *  Empty string when the node kind carries no text. */
export function nodeLabel(node: WhiteboardNode): string {
	if (node.kind === NodeKind.Sticky || node.kind === NodeKind.Text) return node.text.trim();
	if (node.kind === NodeKind.Frame) return node.title.trim();
	return "";
}

/**
 * Summarise the current selection for announcement. One selected id →
 * `single` (with the node's label, kind, and position so a nudge can speak
 * the new coordinates); more than one → `multi` with a count; none → `none`.
 * An id with no matching node (mid-reconcile) is ignored.
 */
export function selectionSummary(
	nodes: ReadonlyArray<WhiteboardNode>,
	selectedIds: ReadonlySet<string>,
): SelectionSummary {
	if (selectedIds.size === 0) return { kind: "none" };
	const present = nodes.filter((n) => selectedIds.has(n.id));
	if (present.length === 0) return { kind: "none" };
	if (present.length === 1) {
		const node = present[0];
		if (node === undefined) return { kind: "none" };
		return {
			kind: "single",
			label: nodeLabel(node),
			nodeKind: node.kind,
			x: Math.round(node.x),
			y: Math.round(node.y),
		};
	}
	return { kind: "multi", count: present.length };
}
