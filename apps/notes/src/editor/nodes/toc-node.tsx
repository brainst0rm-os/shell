/**
 * TableOfContentsNode — a block that auto-lists the document's headings
 * with click-to-scroll, updating live as headings are edited. The live
 * heading list comes from `@lexical/react`'s TableOfContentsPlugin
 * (render-prop); we own only the presentation + scroll behaviour.
 *
 * Carries no data of its own (the headings are derived), so its
 * serialized shape is just the type tag.
 */

import { TableOfContentsPlugin } from "@lexical/react/LexicalTableOfContentsPlugin";
import {
	DecoratorNode,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";
import { t } from "../../i18n/t";

export const TOC_NODE_TYPE = "table-of-contents";
const TOC_NODE_VERSION = 1 as const;

export type SerializedTocNode = SerializedLexicalNode & {
	type: typeof TOC_NODE_TYPE;
	version: typeof TOC_NODE_VERSION;
};

export class TableOfContentsNode extends DecoratorNode<JSX.Element> {
	static override getType(): string {
		return TOC_NODE_TYPE;
	}

	static override clone(node: TableOfContentsNode): TableOfContentsNode {
		return new TableOfContentsNode(node.__key);
	}

	static override importJSON(_s: SerializedTocNode): TableOfContentsNode {
		return new TableOfContentsNode();
	}

	override exportJSON(): SerializedTocNode {
		return { type: TOC_NODE_TYPE, version: TOC_NODE_VERSION };
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const el = document.createElement("div");
		el.className = "notes__toc-host";
		return el;
	}

	override updateDOM(): false {
		return false;
	}

	override decorate(): JSX.Element {
		return <TocView />;
	}

	override isInline(): false {
		return false;
	}
}

function scrollToHeading(editor: LexicalEditor, key: NodeKey): void {
	const el = editor.getElementByKey(key);
	if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function TocView(): JSX.Element {
	return (
		<TableOfContentsPlugin>
			{(entries, editor) => (
				<nav className="notes__toc" aria-label={t("notes.toc.region")}>
					<div className="notes__toc-title">{t("notes.toc.heading")}</div>
					{entries.length === 0 ? (
						<div className="notes__toc-empty">{t("notes.toc.empty")}</div>
					) : (
						<ul className="notes__toc-list">
							{entries.map(([key, text, tag]) => (
								<li key={key} className="notes__toc-item" data-level={tag}>
									<button
										type="button"
										className="notes__toc-link"
										onClick={() => scrollToHeading(editor, key)}
									>
										{text || t("notes.toc.untitled")}
									</button>
								</li>
							))}
						</ul>
					)}
				</nav>
			)}
		</TableOfContentsPlugin>
	);
}

export function $createTableOfContentsNode(): TableOfContentsNode {
	return new TableOfContentsNode();
}

export function $isTableOfContentsNode(
	node: LexicalNode | null | undefined,
): node is TableOfContentsNode {
	return node instanceof TableOfContentsNode;
}
