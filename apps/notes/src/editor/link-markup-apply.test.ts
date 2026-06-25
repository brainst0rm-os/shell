// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { $isLinkNode, AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { applyLinkMarkup } from "./link-markup-plugin";
import { MentionNode } from "./nodes/mention-node";

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

function seedParagraph(editor: LexicalEditor, text: string): string {
	let key = "";
	editor.update(
		() => {
			const paragraph = $createParagraphNode();
			const textNode = $createTextNode(text);
			paragraph.append(textNode);
			$getRoot().append(paragraph);
			key = textNode.getKey();
		},
		{ discrete: true },
	);
	return key;
}

describe("applyLinkMarkup", () => {
	it("wraps the captured selection range in a LinkNode with the supplied URL", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "see Apollo soon");
		applyLinkMarkup(
			editor,
			{
				anchorKey: textKey,
				anchorOffset: 4,
				anchorType: "text",
				focusKey: textKey,
				focusOffset: 10,
				focusType: "text",
			},
			"brainstorm://entity/n_target",
		);
		const json = editor.getEditorState().toJSON();
		const paragraph = json.root.children[0] as unknown as { children: unknown[] };
		const types = paragraph.children.map((c) => (c as { type: string }).type);
		expect(types).toContain("link");
		const link = paragraph.children.find(
			(c): c is { type: "link"; url: string; children: unknown[] } =>
				(c as { type: string }).type === "link",
		);
		expect(link).toBeDefined();
		expect(link?.url).toBe("brainstorm://entity/n_target");
		const linkText = (link?.children[0] as { text: string } | undefined)?.text;
		expect(linkText).toBe("Apollo");
	});

	it("the resulting LinkNode survives a serialise / parse round-trip and stays a LinkNode", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "go Apollo!");
		applyLinkMarkup(
			editor,
			{
				anchorKey: textKey,
				anchorOffset: 3,
				anchorType: "text",
				focusKey: textKey,
				focusOffset: 9,
				focusType: "text",
			},
			"brainstorm://entity/n_target",
		);
		const json = editor.getEditorState().toJSON();
		const replay = createEditor();
		replay.setEditorState(replay.parseEditorState(json));
		let foundHref: string | null = null;
		replay.read(() => {
			const paragraph = $getRoot().getFirstChild();
			if (!paragraph || !("getChildren" in paragraph)) throw new Error("missing paragraph");
			for (const child of (paragraph as { getChildren: () => unknown[] }).getChildren()) {
				if ($isLinkNode(child as never)) {
					foundHref = (child as LinkNode).getURL();
					break;
				}
			}
		});
		expect(foundHref).toBe("brainstorm://entity/n_target");
	});

	it("is a no-op when the captured selection's anchorKey doesn't resolve", () => {
		const editor = createEditor();
		seedParagraph(editor, "untouched text");
		applyLinkMarkup(
			editor,
			{
				anchorKey: "definitely-missing-key",
				anchorOffset: 0,
				anchorType: "text",
				focusKey: "also-missing",
				focusOffset: 1,
				focusType: "text",
			},
			"brainstorm://entity/n_target",
		);
		const json = editor.getEditorState().toJSON();
		const paragraph = json.root.children[0] as unknown as {
			children: { type: string; text?: string }[];
		};
		expect(paragraph.children.map((c) => c.type)).toEqual(["text"]);
		expect(paragraph.children[0]?.text).toBe("untouched text");
	});
});
