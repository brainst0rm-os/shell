// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import {
	$createParagraphNode,
	$getRoot,
	$isElementNode,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
	$createDateMentionNode,
	$isDateMentionNode,
	DateMentionNode,
	type SerializedDateMentionNode,
} from "./date-mention-node";

function editorWithDate(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "dm",
		nodes: [DateMentionNode],
		onError: (e) => {
			throw e;
		},
	});
}

/** The first inline child of the first paragraph — the seeded date chip. */
function firstChip(): LexicalNode | null {
	const para = $getRoot().getFirstChild();
	return $isElementNode(para) ? para.getFirstChild() : null;
}

function seed(editor: LexicalEditor, iso: string, label: string): void {
	editor.update(
		() => {
			const para = $createParagraphNode();
			para.append($createDateMentionNode(iso, label));
			$getRoot().append(para);
		},
		{ discrete: true },
	);
}

describe("DateMentionNode", () => {
	it("serialises type / version / iso / label", () => {
		const editor = editorWithDate();
		seed(editor, "2026-06-04", "Today");
		const root = editor.getEditorState().toJSON().root as unknown as {
			children: { children: SerializedDateMentionNode[] }[];
		};
		const node = root.children[0]?.children[0];
		expect(node).toBeDefined();
		if (!node) return;
		expect(node.type).toBe("date-mention");
		expect(node.version).toBe(1);
		expect(node.iso).toBe("2026-06-04");
		expect(node.label).toBe("Today");
	});

	it("round-trips through serialize → parse", () => {
		const editor = editorWithDate();
		seed(editor, "2026-12-25", "2026-12-25");
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const restored = editorWithDate();
		restored.setEditorState(restored.parseEditorState(JSON.parse(json)));
		restored.getEditorState().read(() => {
			const node = firstChip();
			expect($isDateMentionNode(node)).toBe(true);
			if (!$isDateMentionNode(node)) return;
			expect(node.getIso()).toBe("2026-12-25");
			expect(node.getLabel()).toBe("2026-12-25");
		});
	});

	it("is inline and renders `@<label>` as its plain-text view", () => {
		const editor = editorWithDate();
		seed(editor, "2026-06-04", "Today");
		editor.getEditorState().read(() => {
			const node = firstChip();
			if (!$isDateMentionNode(node)) throw new Error("expected date mention");
			expect(node.isInline()).toBe(true);
			expect(node.getTextContent()).toBe("@Today");
		});
	});

	it("clamps an over-long imported label/iso (hostile body defense)", () => {
		const editor = editorWithDate();
		const long = "x".repeat(200);
		editor.update(
			() => {
				const node = DateMentionNode.importJSON({
					type: "date-mention",
					version: 1,
					iso: long,
					label: long,
				} as SerializedDateMentionNode);
				expect(node.getIso().length).toBe(64);
				expect(node.getLabel().length).toBe(64);
			},
			{ discrete: true },
		);
	});

	it("coerces non-string imported fields to empty strings", () => {
		const editor = editorWithDate();
		editor.update(
			() => {
				const node = DateMentionNode.importJSON({
					type: "date-mention",
					version: 1,
					iso: 42,
					label: null,
				} as unknown as SerializedDateMentionNode);
				expect(node.getIso()).toBe("");
				expect(node.getLabel()).toBe("");
			},
			{ discrete: true },
		);
	});
});
