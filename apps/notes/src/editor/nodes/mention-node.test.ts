// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createMentionNode,
	$isMentionNode,
	MENTION_NODE_TYPE,
	MentionNode,
	type SerializedMentionNode,
} from "./mention-node";

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
		],
		onError(error) {
			throw error;
		},
	});
}

describe("MentionNode", () => {
	it("constructs with entityId / entityType / label and exposes them", () => {
		const editor = createEditor();
		let read = { id: "", type: "", label: "" };
		editor.update(
			() => {
				const node = $createMentionNode("n_abc", "io.brainstorm.notes/Note/v1", "Hello");
				read = { id: node.getEntityId(), type: node.getEntityType(), label: node.getLabel() };
			},
			{ discrete: true },
		);
		expect(read).toEqual({
			id: "n_abc",
			type: "io.brainstorm.notes/Note/v1",
			label: "Hello",
		});
	});

	it("renders as inline + keyboard-selectable", () => {
		const editor = createEditor();
		let snapshot = { inline: false, selectable: false };
		editor.update(
			() => {
				const node = $createMentionNode("n_x", "io.brainstorm.notes/Note/v1", "X");
				snapshot = { inline: node.isInline(), selectable: node.isKeyboardSelectable() };
			},
			{ discrete: true },
		);
		expect(snapshot).toEqual({ inline: true, selectable: true });
	});

	it("getTextContent returns `@<label>` for clipboard / a11y", () => {
		const editor = createEditor();
		let text = "";
		editor.update(
			() => {
				const node = $createMentionNode("n_a", "T/v1", "Project Apollo");
				text = node.getTextContent();
			},
			{ discrete: true },
		);
		expect(text).toBe("@Project Apollo");
	});

	it("falls back to the entityId when label is empty", () => {
		const editor = createEditor();
		let text = "";
		editor.update(
			() => {
				const node = $createMentionNode("n_a", "T/v1", "");
				text = node.getTextContent();
			},
			{ discrete: true },
		);
		expect(text).toBe("@");
	});

	it("exports + re-imports JSON round-trip", () => {
		const editor = createEditor();
		let serialized: SerializedMentionNode | null = null;
		let reimported = { id: "", type: "", label: "" };
		editor.update(
			() => {
				const paragraph = $createParagraphNode();
				const node = $createMentionNode("n_abc", "io.brainstorm.notes/Note/v1", "Hello");
				paragraph.append(node);
				$getRoot().append(paragraph);
				serialized = node.exportJSON();
				const back = MentionNode.importJSON(serialized);
				reimported = {
					id: back.getEntityId(),
					type: back.getEntityType(),
					label: back.getLabel(),
				};
			},
			{ discrete: true },
		);
		expect(serialized).toEqual({
			type: MENTION_NODE_TYPE,
			version: 1,
			entityId: "n_abc",
			entityType: "io.brainstorm.notes/Note/v1",
			label: "Hello",
		});
		expect(reimported).toEqual({
			id: "n_abc",
			type: "io.brainstorm.notes/Note/v1",
			label: "Hello",
		});
	});

	it("importJSON tolerates corrupt / missing fields", () => {
		const editor = createEditor();
		let read = { id: "x", type: "x", label: "x" };
		editor.update(
			() => {
				const node = MentionNode.importJSON({
					type: MENTION_NODE_TYPE,
					version: 1,
					entityId: 42 as unknown as string,
					entityType: null as unknown as string,
					label: undefined as unknown as string,
				});
				read = { id: node.getEntityId(), type: node.getEntityType(), label: node.getLabel() };
			},
			{ discrete: true },
		);
		expect(read).toEqual({ id: "", type: "", label: "" });
	});

	it("clone copies all three fields", () => {
		const editor = createEditor();
		let same = false;
		editor.update(
			() => {
				const node = $createMentionNode("n_a", "T/v1", "Label");
				const cloned = MentionNode.clone(node);
				same =
					cloned.getEntityId() === "n_a" &&
					cloned.getEntityType() === "T/v1" &&
					cloned.getLabel() === "Label";
			},
			{ discrete: true },
		);
		expect(same).toBe(true);
	});

	it("$isMentionNode discriminates against other nodes", () => {
		const editor = createEditor();
		let result = { mention: false, paragraph: false, undef: false };
		editor.update(
			() => {
				const node = $createMentionNode("n_a", "T/v1", "L");
				const paragraph = $createParagraphNode();
				result = {
					mention: $isMentionNode(node),
					paragraph: $isMentionNode(paragraph),
					undef: $isMentionNode(null),
				};
			},
			{ discrete: true },
		);
		expect(result).toEqual({ mention: true, paragraph: false, undef: false });
	});

	it("setLabel writes through getWritable() so updates land", () => {
		const editor = createEditor();
		let after = "";
		editor.update(
			() => {
				const node = $createMentionNode("n_a", "T/v1", "Old");
				node.setLabel("New");
				after = node.getLabel();
			},
			{ discrete: true },
		);
		expect(after).toBe("New");
	});
});
