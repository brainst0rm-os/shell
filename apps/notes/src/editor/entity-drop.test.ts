// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { appendEntityReferences, insertEntityReference } from "./entity-drop-plugin";
import { $isMentionNode, MentionNode } from "./nodes/mention-node";
import { $isTransclusionNode, TransclusionNode } from "./nodes/transclusion-node";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [
			HeadingNode,
			QuoteNode,
			ListNode,
			ListItemNode,
			CodeNode,
			LinkNode,
			AutoLinkNode,
			MentionNode,
			TransclusionNode,
		],
		onError(error) {
			throw error;
		},
	});
}

const PAYLOAD = {
	entityId: "note-2",
	entityType: "io.brainstorm.notes/Note/v1",
	label: "Linked note",
};

describe("insertEntityReference", () => {
	it("appends a paragraph carrying an inline MentionNode on a plain drop", () => {
		const editor = createEditor();
		let found = { mention: false, id: "", label: "" };
		editor.update(
			() => {
				insertEntityReference(editor, PAYLOAD, false);
			},
			{ discrete: true },
		);
		editor.getEditorState().read(() => {
			for (const block of $getRoot().getChildren()) {
				for (const child of (block as { getChildren?: () => unknown[] }).getChildren?.() ?? []) {
					if ($isMentionNode(child as never)) {
						const m = child as MentionNode;
						found = { mention: true, id: m.getEntityId(), label: m.getLabel() };
					}
				}
			}
		});
		expect(found).toEqual({ mention: true, id: "note-2", label: "Linked note" });
	});

	it("appends a block-level TransclusionNode on an alt-drop", () => {
		const editor = createEditor();
		let found = { transclusion: false, id: "" };
		editor.update(
			() => {
				insertEntityReference(editor, PAYLOAD, true);
			},
			{ discrete: true },
		);
		editor.getEditorState().read(() => {
			for (const block of $getRoot().getChildren()) {
				if ($isTransclusionNode(block)) {
					found = { transclusion: true, id: (block as TransclusionNode).getEntityId() };
				}
			}
		});
		expect(found).toEqual({ transclusion: true, id: "note-2" });
	});
});

describe("appendEntityReferences (cross-app multi-item drop)", () => {
	it("appends every dropped object as a mention IN ORDER (not reversed)", () => {
		const editor = createEditor();
		const items = ["a", "b", "c"].map((id) => ({
			entityId: id,
			entityType: "io.brainstorm.notes/Note/v1",
			label: id.toUpperCase(),
		}));
		appendEntityReferences(editor, items);

		const ids: string[] = [];
		editor.getEditorState().read(() => {
			for (const block of $getRoot().getChildren()) {
				for (const child of (block as { getChildren?: () => unknown[] }).getChildren?.() ?? []) {
					if ($isMentionNode(child as never)) ids.push((child as MentionNode).getEntityId());
				}
			}
		});
		expect(ids).toEqual(["a", "b", "c"]);
	});
});
