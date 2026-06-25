/**
 * TitlePlugin — enforces "root.firstChild is always THE one and only
 * TitleNode".
 *
 * RootNode transform: if the root has no children, append [TitleNode,
 * ParagraphNode]; if root's first child isn't a TitleNode, prepend an
 * empty TitleNode; and demote any *other* TitleNode (one that isn't the
 * first child) to a plain ParagraphNode keeping its text. Lexical re-runs
 * transforms until they stabilise, so the invariant holds across edits,
 * paste, undo, collab merge, and block drag-reorder — all of which can
 * otherwise leave a second `<h1>` title in the body (e.g. dragging a
 * paragraph above the title makes the transform prepend a fresh title
 * while the original drops to a second one).
 *
 * The Enter-in-title behaviour is encoded on the node itself
 * (`TitleNode.insertNewAfter` returns a `ParagraphNode`).
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, RootNode, type RootNode as RootNodeType } from "lexical";
import { useEffect } from "react";
import { $createTitleNode, $isTitleNode } from "../nodes/title-node";

/** Apply the "exactly one TitleNode, and it's root[0]" invariant. Pure
 *  over the live root node so it's unit-testable without mounting React. */
export function enforceTitleInvariant(root: RootNodeType): void {
	const first = root.getFirstChild();
	if (first === null) {
		root.append($createTitleNode(), $createParagraphNode());
		return;
	}
	if (!$isTitleNode(first)) {
		first.insertBefore($createTitleNode());
	}
	// Demote any title that isn't the first child. A note has exactly one
	// title; a second `<h1>` is always a bug (drag-reorder / paste / merge).
	for (const child of root.getChildren()) {
		if (child === root.getFirstChild()) continue;
		if (!$isTitleNode(child)) continue;
		const paragraph = $createParagraphNode();
		const direction = child.getDirection();
		if (direction) paragraph.setDirection(direction);
		paragraph.setFormat(child.getFormatType());
		paragraph.setIndent(child.getIndent());
		for (const grandchild of child.getChildren()) paragraph.append(grandchild);
		child.replace(paragraph);
	}
}

export function TitlePlugin() {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		return editor.registerNodeTransform(RootNode, enforceTitleInvariant);
	}, [editor]);

	return null;
}
