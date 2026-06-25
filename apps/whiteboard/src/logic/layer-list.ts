/**
 * Layer list (9.17.13) — the ordered rows the layers panel renders, derived
 * from the board's nodes. Top-of-stack first (effective z descending, document
 * order as the tiebreak — the inverse of the paint order, so the visually
 * top-most node is the first row). Pure so the ordering + label derivation are
 * proven without the panel DOM.
 */

import { NodeKind, type WhiteboardNode } from "../types/node";

export type LayerRow = {
	id: string;
	kind: NodeKind;
	/** A short content snippet for identification (sticky/text body, frame
	 *  title) — empty when the kind has no inherent text; the panel falls back
	 *  to the localized kind name. */
	snippet: string;
	locked: boolean;
	hidden: boolean;
};

function snippetOf(node: WhiteboardNode): string {
	switch (node.kind) {
		case NodeKind.Sticky:
		case NodeKind.Text:
			return node.text.trim();
		case NodeKind.Frame:
			return node.title.trim();
		default:
			return "";
	}
}

export function buildLayerList(nodes: readonly WhiteboardNode[]): LayerRow[] {
	return nodes
		.map((node, index) => ({ node, index }))
		.sort((a, b) => (b.node.zIndex ?? 0) - (a.node.zIndex ?? 0) || a.index - b.index)
		.map(({ node }) => ({
			id: node.id,
			kind: node.kind,
			snippet: snippetOf(node),
			locked: node.locked ?? false,
			hidden: node.hidden ?? false,
		}));
}
