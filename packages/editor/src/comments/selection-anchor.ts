/**
 * Comment-on-selection anchor extraction (B11.9). Given the current Lexical
 * range selection, returns the block-anchored comment target: the enclosing
 * top-level block's (session) key + the selected text as the quote. Block-level
 * (not raw char range) so the anchor survives a re-typed block, matching the
 * `Comment/v1` contract. Run inside `editor.read` / `editor.getEditorState().read`.
 */

import { $getSelection, $isRangeSelection } from "lexical";
import { topLevelKeyOf } from "../top-level-block";

export type SelectionCommentAnchor = {
	/** Session block id (the top-level block's NodeKey). Durable cross-reload
	 *  anchoring waits on the Lexical NodeState upgrade — see B11.13. */
	blockId: string;
	/** The selected text, trimmed — shown as the thread's quote context. */
	quote: string;
};

export function $commentAnchorFromSelection(): SelectionCommentAnchor | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return null;
	const blockId = topLevelKeyOf(selection.anchor.getNode());
	if (blockId === null) return null;
	return { blockId, quote: selection.getTextContent().trim() };
}
