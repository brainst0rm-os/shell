/**
 * "A top-level block is not only an `ElementNode`."
 *
 * Notes has ~12 block kinds that are `DecoratorNode`s (equation/math,
 * image, video, audio, file, bookmark, web-embed, property-block,
 * property-list, TOC, …) sitting as direct children of root. Two
 * editor subsystems wrongly assumed every block was an `ElementNode`:
 *
 *   - the block gutter filtered hover/drag targets on `$isElementNode`,
 *     so a math/image/embed block had **no grip or ＋** and could not be
 *     dragged ("math block has no block buttons");
 *   - block-selection resolved the clicked block via
 *     `getTopLevelElementOrThrow()`, which *throws* for a top-level
 *     decorator — swallowed as "nothing to select", so those blocks
 *     could not be block-selected at all (the "weird selection").
 *
 * Both now share these two pure helpers. Inline decorators (mention,
 * inline equation) are explicitly NOT blocks.
 *
 * **List items are blocks.** Lexical models a bulleted/numbered/todo
 * list as a single `ListNode` wrapping `ListItemNode` children. For
 * selection / gutter / drag purposes, each list-item is its own row
 * (mirrors a row-per-item block-tree data model). `topLevelKeyOf` therefore walks
 * up the tree and returns the first `ListItemNode` it encounters
 * before reaching root — for a click anywhere inside a list item's
 * text, that's the item's own key. Nested list items each get their
 * own block; the surrounding `ListNode` is *not* a block (the list is
 * a container, not a row).
 *
 * Lifted from `apps/notes/src/editor/top-level-block.ts` at 13.4a.1 so
 * the editor virtualization plugin (which also walks "all top-level
 * blocks") shares a single source of truth with the Notes-side gutter,
 * block-selection, marquee, and clipboard. Notes re-exports from here.
 */

import { $isListItemNode, $isListNode, type ListItemNode, type ListNode } from "@lexical/list";
import {
	$isDecoratorNode,
	$isElementNode,
	$isRootNode,
	type LexicalNode,
	type NodeKey,
} from "lexical";

/** Is `node` a block row (gets a gutter, drag-reorders, block-selects)?
 *  - Any `ListItemNode` (including nested ones).
 *  - Any non-inline `DecoratorNode` at root.
 *  - Any `ElementNode` at root *except* `ListNode` (the list is a
 *    container, not a row — its `ListItemNode` children are the rows).
 *  For nodes not adjacent to root this check is conservative and only
 *  uses local structure; callers that need positional knowledge ("is
 *  `node` a direct child of root or a list?") use [[getAllBlocks]]. */
export function isTopLevelBlock(node: LexicalNode): boolean {
	if ($isListItemNode(node)) return true;
	if ($isListNode(node)) return false;
	if ($isElementNode(node)) return true;
	return $isDecoratorNode(node) && !node.isInline();
}

/**
 * Key of the block that contains `node`. A block is either a
 * `ListItemNode` (anywhere in the tree) or a direct child of root
 * other than a `ListNode`. Returns `null` only when `node` is detached
 * or is the root itself. The throw-free, decorator-and-list-safe
 * replacement for `getTopLevelElementOrThrow()`.
 */
export function topLevelKeyOf(node: LexicalNode): NodeKey | null {
	let current: LexicalNode | null = node;
	while (current) {
		if ($isListItemNode(current)) return current.getKey();
		const parent: LexicalNode | null = current.getParent();
		if (!parent) return null; // detached, or `node` is the root
		if ($isRootNode(parent)) {
			// A bare `ListNode` at root has no row identity of its own; if a
			// click lands on its padding (between items) we return null and
			// the caller treats it as "nothing to select".
			if ($isListNode(current)) return null;
			return current.getKey();
		}
		current = parent;
	}
	return null;
}

/**
 * Ordered, list-item-aware enumeration of every block in the document.
 * For each direct child of root: yields the child itself unless it's a
 * `ListNode`, in which case every `ListItemNode` it contains is
 * yielded in DOM order (recursing through nested lists). This is the
 * single source of truth for "which blocks exist, in what order" used
 * by the gutter (hover / drop target picker), block-selection
 * (keyboard nav ordering, Cmd+A range), and clipboard serialization.
 */
export function getAllBlocks(root: LexicalNode): LexicalNode[] {
	if (!$isElementNode(root)) return [];
	const blocks: LexicalNode[] = [];
	for (const child of root.getChildren()) {
		if ($isListNode(child)) {
			collectListItems(child, blocks);
			continue;
		}
		blocks.push(child);
	}
	return blocks;
}

function collectListItems(list: ListNode, out: LexicalNode[]): void {
	for (const item of list.getChildren()) {
		if (!$isListItemNode(item)) continue;
		out.push(item);
		// A nested list inside a list-item shows up as a `ListNode` child of
		// the item; its items are siblings *visually* on the next indent
		// level — yield them next so the linear order matches DOM order.
		for (const sub of (item as ListItemNode).getChildren()) {
			if ($isListNode(sub)) collectListItems(sub, out);
		}
	}
}

/** The "parent" of a block for sibling-relative operations
 *  (moveBlocksUp/Down, etc.). List items are siblings within their
 *  parent `ListNode`; everything else is a sibling at root. */
export function blockParentOf(node: LexicalNode): LexicalNode | null {
	if ($isListItemNode(node)) return node.getParent();
	const parent = node.getParent();
	if (parent && $isRootNode(parent)) return parent;
	return null;
}
