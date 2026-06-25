import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$isElementNode,
	$setSelection,
} from "lexical";
import { describe, expect, it } from "vitest";
import { createBrainstormHeadlessEditor } from "../headless";
import { $commentAnchorFromSelection } from "./selection-anchor";

function seedParagraph(editor: ReturnType<typeof createBrainstormHeadlessEditor>): string {
	let key = "";
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			const para = $createParagraphNode();
			para.append($createTextNode("Hello brave new world"));
			root.append(para);
			key = para.getKey();
		},
		{ discrete: true },
	);
	return key;
}

describe("$commentAnchorFromSelection", () => {
	it("returns the enclosing block key + the selected text as the quote", () => {
		const editor = createBrainstormHeadlessEditor();
		const blockKey = seedParagraph(editor);
		let anchor: ReturnType<typeof $commentAnchorFromSelection> = null;
		editor.update(
			() => {
				const para = $getRoot().getFirstChild();
				const text = $isElementNode(para) ? para.getFirstChild() : null;
				const selection = $createRangeSelection();
				// Select "brave" (chars 6..11 of "Hello brave new world").
				selection.anchor.set(text?.getKey() ?? "", 6, "text");
				selection.focus.set(text?.getKey() ?? "", 11, "text");
				$setSelection(selection);
				anchor = $commentAnchorFromSelection();
			},
			{ discrete: true },
		);
		expect(anchor).toEqual({ blockId: blockKey, quote: "brave" });
	});

	it("returns null when there is no range selection", () => {
		const editor = createBrainstormHeadlessEditor();
		seedParagraph(editor);
		let anchor: ReturnType<typeof $commentAnchorFromSelection> = null;
		editor.update(
			() => {
				$setSelection(null);
				anchor = $commentAnchorFromSelection();
			},
			{ discrete: true },
		);
		expect(anchor).toBeNull();
	});
});
