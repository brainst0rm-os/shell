// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createColumnNode,
	$createColumnsNode,
	$isColumnNode,
	$isColumnsNode,
	ColumnNode,
	ColumnsNode,
} from "./columns-node";

function editor(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "col",
		nodes: [ColumnsNode, ColumnNode],
		onError: (e) => {
			throw e;
		},
	});
}

describe("ColumnsNode / ColumnNode", () => {
	it("round-trips a 3-column layout with per-column flex", () => {
		const e = editor();
		e.update(
			() => {
				const columns = $createColumnsNode();
				columns.append($createColumnNode(2).append($createParagraphNode()));
				columns.append($createColumnNode(1).append($createParagraphNode()));
				columns.append($createColumnNode(1).append($createParagraphNode()));
				$getRoot().append(columns);
			},
			{ discrete: true },
		);
		const json = JSON.stringify(e.getEditorState().toJSON());
		const next = editor();
		next.setEditorState(next.parseEditorState(json));
		next.getEditorState().read(() => {
			const columns = $getRoot().getFirstChild();
			expect($isColumnsNode(columns)).toBe(true);
			if (!$isColumnsNode(columns)) return;
			const cols = columns.getChildren();
			expect(cols).toHaveLength(3);
			expect(cols.every($isColumnNode)).toBe(true);
			expect((cols[0] as ColumnNode).getFlex()).toBe(2);
			expect((cols[1] as ColumnNode).getFlex()).toBe(1);
		});
	});

	it("clamps flex into [0.25, 8]", () => {
		const e = editor();
		e.update(
			() => {
				const c = $createColumnNode(99);
				$getRoot().append($createColumnsNode().append(c));
				expect(c.getFlex()).toBe(8);
				c.setFlex(0);
				expect(c.getFlex()).toBe(0.25);
				c.setFlex(1.5);
				expect(c.getFlex()).toBe(1.5);
			},
			{ discrete: true },
		);
	});
});
