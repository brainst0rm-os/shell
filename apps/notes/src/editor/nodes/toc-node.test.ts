// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createTableOfContentsNode,
	$isTableOfContentsNode,
	TableOfContentsNode,
} from "./toc-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "toc",
		nodes: [TableOfContentsNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("TableOfContentsNode", () => {
	it("is a block node that survives a serialize → parse round-trip", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createTableOfContentsNode());
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isTableOfContentsNode(n)).toBe(true);
			if ($isTableOfContentsNode(n)) {
				expect(n.isInline()).toBe(false);
				expect(n.exportJSON()).toMatchObject({
					type: "table-of-contents",
					version: 1,
				});
			}
		});
	});
});
