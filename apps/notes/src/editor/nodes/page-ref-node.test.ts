// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createPageRefNode, $isPageRefNode, PageRefNode } from "./page-ref-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "pr",
		nodes: [PageRefNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("PageRefNode", () => {
	it("round-trips entityId / entityType / label and is a block node", () => {
		const e = editor();
		e.update(
			() => {
				$getRoot().append($createPageRefNode("n_child1", "io.brainstorm.notes/Note/v1", "Child"));
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isPageRefNode(n)).toBe(true);
			if (!$isPageRefNode(n)) return;
			expect(n.getEntityId()).toBe("n_child1");
			expect(n.isInline()).toBe(false);
			expect(n.getTextContent()).toBe("Child");
			expect(n.exportJSON()).toMatchObject({
				type: "page-ref",
				entityId: "n_child1",
				entityType: "io.brainstorm.notes/Note/v1",
				label: "Child",
			});
		});
	});

	it("coerces missing fields to empty strings on import", () => {
		const e = editor();
		e.setEditorState(
			e.parseEditorState(
				JSON.stringify({
					root: {
						type: "root",
						format: "",
						indent: 0,
						version: 1,
						direction: null,
						children: [{ type: "page-ref", version: 1 }],
					},
				}),
			),
		);
		e.getEditorState().read(() => {
			const n = $getRoot().getFirstChild();
			expect($isPageRefNode(n) && n.getEntityId()).toBe("");
		});
	});
});
