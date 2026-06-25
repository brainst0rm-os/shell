// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { LinkNode } from "@lexical/link";
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$isElementNode,
	$setSelection,
	type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import { insertPastedLink } from "./bookmark-suggest-plugin";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "bookmark-suggest",
		nodes: [LinkNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("insertPastedLink", () => {
	it("inserts a LinkNode at the caret and returns the enclosing block key", () => {
		const e = editor();
		let caretKey = "";
		e.update(
			() => {
				const p = $createParagraphNode();
				const text = $createTextNode("");
				p.append(text);
				$getRoot().append(p);
				const sel = $createRangeSelection();
				sel.anchor.set(text.getKey(), 0, "text");
				sel.focus.set(text.getKey(), 0, "text");
				$setSelection(sel);
				caretKey = p.getKey();
			},
			{ discrete: true },
		);

		const blockKey = insertPastedLink(e, "https://example.com/post");
		expect(blockKey).toBe(caretKey);

		e.getEditorState().read(() => {
			const block = $getRoot().getFirstChild();
			expect(block && $isElementNode(block)).toBe(true);
			if (!$isElementNode(block)) return;
			// The block now contains a link whose text is the pasted URL.
			expect(block.getTextContent()).toContain("https://example.com/post");
			const link = block.getChildren().find((n) => n instanceof LinkNode) as LinkNode | undefined;
			expect(link).toBeInstanceOf(LinkNode);
			expect(link?.getURL()).toBe("https://example.com/post");
		});
	});

	it("returns null when there is no range selection", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createParagraphNode());
				$setSelection(null);
			},
			{ discrete: true },
		);
		expect(insertPastedLink(e, "https://example.com")).toBeNull();
	});
});
