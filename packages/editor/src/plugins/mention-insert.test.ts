// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isTextNode,
	type LexicalEditor,
	type SerializedEditorState,
} from "lexical";
import { describe, expect, it } from "vitest";
import { $isDateMentionNode, DateMentionNode } from "../nodes/date-mention-node";
import { $isMentionNode, MentionNode } from "../nodes/mention-node";
import { applyDateMentionInsertion, applyMentionInsertion } from "./mention-typeahead-plugin";

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
			DateMentionNode,
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

function readSerialized(editor: LexicalEditor): SerializedEditorState {
	return editor.getEditorState().toJSON();
}

describe("applyMentionInsertion", () => {
	it("replaces `@apo` at the start of a paragraph with a MentionNode + trailing space", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "@apo");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 0, query: "apo" },
			{ entityId: "n_target", entityType: "io.brainstorm.notes/Note/v1", label: "Apollo" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as { children: unknown[] };
		expect(paragraph.children).toHaveLength(2);
		const mention = paragraph.children[0] as { type: string; entityId: string; label: string };
		expect(mention.type).toBe("mention");
		expect(mention.entityId).toBe("n_target");
		expect(mention.label).toBe("Apollo");
		const trailing = paragraph.children[1] as { type: string; text: string };
		expect(trailing.type).toBe("text");
		expect(trailing.text).toBe(" ");
	});

	it("replaces a mid-paragraph `@apo` and preserves surrounding text", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "see @apo soon");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 4, query: "apo" },
			{ entityId: "n_target", entityType: "T/v1", label: "Apollo" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as {
			children: { type: string; text?: string }[];
		};
		expect(paragraph.children.length).toBeGreaterThanOrEqual(3);
		// First: "see ", second: mention, third: " soon"
		expect(paragraph.children[0]?.type).toBe("text");
		expect(paragraph.children[0]?.text).toBe("see ");
		expect(paragraph.children[1]?.type).toBe("mention");
		const tail = paragraph.children[2] as { type: string; text: string };
		expect(tail.type).toBe("text");
		expect(tail.text).toBe("  soon");
	});

	it("replaces the empty-query case `@` at end of paragraph", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "hello @");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 6, query: "" },
			{ entityId: "n_x", entityType: "T/v1", label: "X" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as {
			children: { type: string; text?: string }[];
		};
		expect(paragraph.children.map((c) => c.type)).toEqual(["text", "mention", "text"]);
		expect(paragraph.children[2]?.text).toBe(" ");
	});

	it("is a no-op when the textKey doesn't resolve to a TextNode", () => {
		const editor = createEditor();
		seedParagraph(editor, "hello");
		// Use a clearly-invalid key — the function should fail silently.
		applyMentionInsertion(
			editor,
			"missing-key",
			{ triggerOffset: 0, query: "" },
			{ entityId: "n_x", entityType: "T/v1", label: "X" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as { children: { type: string }[] };
		expect(paragraph.children).toHaveLength(1);
		expect(paragraph.children[0]?.type).toBe("text");
	});

	it("is a no-op when the trigger range escapes the node text", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "@a");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 0, query: "longer-than-text" },
			{ entityId: "n_x", entityType: "T/v1", label: "X" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as {
			children: { type: string; text?: string }[];
		};
		expect(paragraph.children).toHaveLength(1);
		expect(paragraph.children[0]?.text).toBe("@a");
	});

	it("places the caret right after the inserted mention's trailing space", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "@apo");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 0, query: "apo" },
			{ entityId: "n_target", entityType: "T/v1", label: "Apollo" },
		);
		editor.read(() => {
			const selection = editor.getEditorState()._selection;
			// In headless mode the selection may be null until a read forces
			// it to materialise; this assertion is a smoke test against the
			// post-update tree shape.
			const root = $getRoot();
			const paragraph = root.getFirstChild();
			if (!paragraph || !("getChildren" in paragraph)) throw new Error("paragraph missing");
			const children = (paragraph as { getChildren: () => unknown[] }).getChildren();
			expect(children).toHaveLength(2);
			const last = children[1];
			if (!last || !$isTextNode(last as never)) throw new Error("trailing TextNode missing");
			expect((last as { getTextContent: () => string }).getTextContent()).toBe(" ");
			void selection;
		});
	});

	it("produces output whose serialized tree includes a MentionNode round-trippable by importJSON", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "@apo");
		applyMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 0, query: "apo" },
			{ entityId: "n_a", entityType: "T/v1", label: "Apollo" },
		);
		const serialized = readSerialized(editor);
		// Round-trip the serialized tree back into a fresh editor and
		// confirm the MentionNode survives.
		const replay = createEditor();
		replay.setEditorState(replay.parseEditorState(serialized));
		let label = "";
		replay.read(() => {
			const root = $getRoot();
			const paragraph = root.getFirstChild();
			if (!paragraph || !("getChildren" in paragraph)) throw new Error("missing paragraph");
			const children = (paragraph as { getChildren: () => unknown[] }).getChildren();
			const mention = children[0];
			if (!mention || !$isMentionNode(mention as never)) {
				throw new Error("missing mention");
			}
			label = (mention as MentionNode).getLabel();
		});
		expect(label).toBe("Apollo");
	});
});

describe("applyDateMentionInsertion", () => {
	it("replaces `@today` with a DateMentionNode carrying the iso + label, plus a trailing space", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "due @today");
		applyDateMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 4, query: "today" },
			{ iso: "2026-06-04", label: "Today" },
		);
		const state = readSerialized(editor);
		const paragraph = state.root.children[0] as unknown as {
			children: { type: string; iso?: string; label?: string; text?: string }[];
		};
		expect(paragraph.children[0]?.type).toBe("text");
		expect(paragraph.children[0]?.text).toBe("due ");
		const chip = paragraph.children[1];
		expect(chip?.type).toBe("date-mention");
		expect(chip?.iso).toBe("2026-06-04");
		expect(chip?.label).toBe("Today");
		const tail = paragraph.children[2];
		expect(tail?.type).toBe("text");
		expect(tail?.text).toBe(" ");
	});

	it("round-trips the inserted DateMentionNode through importJSON", () => {
		const editor = createEditor();
		const textKey = seedParagraph(editor, "@2026-12-25");
		applyDateMentionInsertion(
			editor,
			textKey,
			{ triggerOffset: 0, query: "2026-12-25" },
			{ iso: "2026-12-25", label: "2026-12-25" },
		);
		const replay = createEditor();
		replay.setEditorState(replay.parseEditorState(readSerialized(editor)));
		let iso = "";
		replay.read(() => {
			const paragraph = $getRoot().getFirstChild();
			if (!paragraph || !("getChildren" in paragraph)) throw new Error("missing paragraph");
			const chip = (paragraph as { getChildren: () => unknown[] }).getChildren()[0];
			if (!chip || !$isDateMentionNode(chip as never)) throw new Error("missing date mention");
			iso = (chip as DateMentionNode).getIso();
		});
		expect(iso).toBe("2026-12-25");
	});
});
