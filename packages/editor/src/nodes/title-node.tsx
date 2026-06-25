/**
 * TitleNode — the document title rendered as the first child of root.
 *
 * Subclass of `ParagraphNode` so we inherit all of paragraph's editing
 * (wrap, marks, inline children including mentions). The differences:
 *   - Renders as `<h1 class="notes__title">` instead of `<p>`.
 *   - `insertNewAfter` returns a `ParagraphNode` — pressing Enter inside
 *     the title moves the caret into a fresh paragraph below, never
 *     into another title.
 *   - `collapseAtStart` returns `false` — Backspace at offset 0 keeps
 *     the title and doesn't merge it into anything.
 *
 * Persisted shape (`type: "title"`) is part of the body's
 * `SerializedEditorState`. The shell's `extract-note-references` walker
 * traverses children generically, so mentions inside the title surface
 * as `VaultLink` rows for free.
 */

import {
	$applyNodeReplacement,
	$createParagraphNode,
	type EditorConfig,
	type LexicalNode,
	ParagraphNode as LexicalParagraphNode,
	type ParagraphNode,
	type RangeSelection,
	type SerializedParagraphNode,
} from "lexical";

export const TITLE_NODE_TYPE = "title";
const TITLE_NODE_VERSION = 1 as const;

export type SerializedTitleNode = SerializedParagraphNode & {
	type: typeof TITLE_NODE_TYPE;
	version: typeof TITLE_NODE_VERSION;
};

export class TitleNode extends LexicalParagraphNode {
	static override getType(): string {
		return TITLE_NODE_TYPE;
	}

	static override clone(node: TitleNode): TitleNode {
		return new TitleNode(node.__key);
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = document.createElement("h1");
		dom.classList.add("notes__title");
		const dir = this.getDirection();
		if (dir) dom.dir = dir;
		return dom;
	}

	override updateDOM(_prev: TitleNode, _dom: HTMLElement, _config: EditorConfig): boolean {
		return false;
	}

	static override importJSON(serialized: SerializedTitleNode): TitleNode {
		const node = $createTitleNode();
		node.setFormat(serialized.format);
		node.setIndent(serialized.indent);
		node.setDirection(serialized.direction);
		node.setTextFormat(serialized.textFormat);
		node.setTextStyle(serialized.textStyle);
		return node;
	}

	override exportJSON(): SerializedTitleNode {
		return {
			...super.exportJSON(),
			type: TITLE_NODE_TYPE,
			version: TITLE_NODE_VERSION,
		};
	}

	override insertNewAfter(_selection: RangeSelection, restoreSelection?: boolean): ParagraphNode {
		const paragraph = $createParagraphNode();
		const direction = this.getDirection();
		if (direction) paragraph.setDirection(direction);
		this.insertAfter(paragraph, restoreSelection);
		return paragraph;
	}

	override collapseAtStart(): boolean {
		return false;
	}
}

export function $createTitleNode(): TitleNode {
	return $applyNodeReplacement(new TitleNode());
}

export function $isTitleNode(node?: LexicalNode | null): node is TitleNode {
	return node instanceof TitleNode;
}
