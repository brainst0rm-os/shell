/**
 * Node styling (9.17.12) — pure selection transforms for the **Style ▾** menu.
 *
 * Two styleable surfaces: any text-bearing node (Sticky / Text) takes a body
 * `textSize`; only a Sticky takes a `color` fill. Each function returns a new
 * `nodes` array with the matching selected nodes patched and everything else
 * referentially unchanged — the app swaps the array into state and repaints.
 * The predicates drive the menu's enable/disable state.
 */

import {
	type FontFamily,
	type StickyColor,
	type StickyNode,
	type TextColor,
	type TextNode,
	type TextSize,
	type WhiteboardNode,
	isSticky,
	isText,
} from "../types/node";

/** True when at least one selected node carries body text (Sticky or Text) —
 *  i.e. the text-size rows should be enabled. */
export function hasStyleableText(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
): boolean {
	return nodes.some((n) => ids.has(n.id) && (isSticky(n) || isText(n)));
}

/** True when at least one selected node is a Sticky — fill rows enabled. */
export function hasSticky(nodes: readonly WhiteboardNode[], ids: ReadonlySet<string>): boolean {
	return nodes.some((n) => ids.has(n.id) && isSticky(n));
}

/** Apply `size` to every selected text-bearing node; non-text and unselected
 *  nodes pass through by reference. */
export function setTextSizeFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	size: TextSize,
): WhiteboardNode[] {
	return nodes.map((n) =>
		ids.has(n.id) && (isSticky(n) || isText(n)) ? { ...n, textSize: size } : n,
	);
}

/** Apply `color` fill to every selected Sticky; everything else passes
 *  through by reference (Text/Shape/etc. have no sticky fill). */
export function setStickyFillFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	color: StickyColor,
): WhiteboardNode[] {
	return nodes.map((n) => (ids.has(n.id) && isSticky(n) ? { ...n, color } : n));
}

/** Apply `textColor` to every selected text-bearing node (9.17.12). */
export function setTextColorFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	textColor: TextColor,
): WhiteboardNode[] {
	return nodes.map((n) => (ids.has(n.id) && (isSticky(n) || isText(n)) ? { ...n, textColor } : n));
}

/** Apply `fontFamily` to every selected text-bearing node (9.17.12). */
export function setFontFamilyFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	fontFamily: FontFamily,
): WhiteboardNode[] {
	return nodes.map((n) => (ids.has(n.id) && (isSticky(n) || isText(n)) ? { ...n, fontFamily } : n));
}

/** Set whole-node `bold` on every selected text-bearing node (9.17.12). */
export function setBoldFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	bold: boolean,
): WhiteboardNode[] {
	return nodes.map((n) => (ids.has(n.id) && (isSticky(n) || isText(n)) ? { ...n, bold } : n));
}

/** Set whole-node `italic` on every selected text-bearing node (9.17.12). */
export function setItalicFor(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
	italic: boolean,
): WhiteboardNode[] {
	return nodes.map((n) => (ids.has(n.id) && (isSticky(n) || isText(n)) ? { ...n, italic } : n));
}

/** True when every styleable selected node is bold (9.17.12) — drives the
 *  toggle's pressed reflection. False when nothing styleable is selected. */
export function selectionBold(nodes: readonly WhiteboardNode[], ids: ReadonlySet<string>): boolean {
	const styleable = nodes.filter(
		(n): n is StickyNode | TextNode => ids.has(n.id) && (isSticky(n) || isText(n)),
	);
	return styleable.length > 0 && styleable.every((n) => n.bold === true);
}

/** True when every styleable selected node is italic (9.17.12). */
export function selectionItalic(
	nodes: readonly WhiteboardNode[],
	ids: ReadonlySet<string>,
): boolean {
	const styleable = nodes.filter(
		(n): n is StickyNode | TextNode => ids.has(n.id) && (isSticky(n) || isText(n)),
	);
	return styleable.length > 0 && styleable.every((n) => n.italic === true);
}
