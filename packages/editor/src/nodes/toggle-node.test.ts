// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { ToggleVariant } from "../block-types";
import {
	$createToggleNode,
	$isToggleNode,
	type SerializedToggleNode,
	ToggleNode,
} from "./toggle-node";

function editorWithToggle(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "tg",
		nodes: [ToggleNode],
		onError: (e) => {
			throw e;
		},
	});
}

function seed(editor: LexicalEditor, variant: ToggleVariant, bsId?: string): void {
	editor.update(
		() => {
			const toggle = $createToggleNode(variant, bsId);
			const title = $createParagraphNode().append($createTextNode("Summary"));
			const body = $createParagraphNode().append($createTextNode("Body"));
			toggle.append(title, body);
			$getRoot().append(toggle);
		},
		{ discrete: true },
	);
}

describe("ToggleNode", () => {
	it("serialises type / variant / bsId and its children", () => {
		const editor = editorWithToggle();
		seed(editor, ToggleVariant.Heading2, "fixed-id");
		const root = editor.getEditorState().toJSON().root as unknown as {
			children: SerializedToggleNode[];
		};
		const node = root.children[0];
		expect(node).toBeDefined();
		if (!node) return;
		expect(node.type).toBe("toggle");
		expect(node.variant).toBe(ToggleVariant.Heading2);
		expect(node.bsId).toBe("fixed-id");
		expect(node.children).toHaveLength(2);
		// Collapsed state is per-device chrome — never serialised onto the node.
		expect("open" in node).toBe(false);
	});

	it("mints a fresh, unique bsId when none is supplied", () => {
		const editor = editorWithToggle();
		editor.update(
			() => {
				const a = $createToggleNode(ToggleVariant.Paragraph);
				const b = $createToggleNode(ToggleVariant.Paragraph);
				expect(a.getBlockId().length).toBeGreaterThan(0);
				expect(a.getBlockId()).not.toBe(b.getBlockId());
			},
			{ discrete: true },
		);
	});

	it("keeps a stable bsId across a writable mutation (variant change reconcile)", () => {
		const editor = editorWithToggle();
		seed(editor, ToggleVariant.Paragraph, "keep-me");
		editor.update(
			() => {
				const node = $getRoot().getFirstChild();
				if ($isToggleNode(node)) node.setVariant(ToggleVariant.Heading1);
			},
			{ discrete: true },
		);
		editor.getEditorState().read(() => {
			const node = $getRoot().getFirstChild();
			if (!$isToggleNode(node)) throw new Error("expected toggle");
			expect(node.getBlockId()).toBe("keep-me");
			expect(node.getVariant()).toBe(ToggleVariant.Heading1);
		});
	});

	it("round-trips through serialize → parse, keeping bsId + variant + children", () => {
		const editor = editorWithToggle();
		seed(editor, ToggleVariant.Heading3, "rt-id");
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const restored = editorWithToggle();
		restored.setEditorState(restored.parseEditorState(JSON.parse(json)));
		restored.getEditorState().read(() => {
			const node = $getRoot().getFirstChild();
			expect($isToggleNode(node)).toBe(true);
			if (!$isToggleNode(node)) return;
			expect(node.getBlockId()).toBe("rt-id");
			expect(node.getVariant()).toBe(ToggleVariant.Heading3);
			expect(node.getTextContent()).toContain("Summary");
			expect(node.getTextContent()).toContain("Body");
		});
	});

	it("coerces an unknown variant to Paragraph and mints a bsId when absent (legacy doc)", () => {
		const editor = editorWithToggle();
		editor.update(
			() => {
				const legacy = {
					children: [],
					direction: null,
					format: "",
					indent: 0,
					type: "toggle",
					version: 1,
					variant: "totally-invalid",
					// legacy docs carried `open` and no `bsId`
					open: false,
				} as unknown as SerializedToggleNode;
				const node = ToggleNode.importJSON(legacy);
				expect(node.getVariant()).toBe(ToggleVariant.Paragraph);
				expect(node.getBlockId().length).toBeGreaterThan(0);
			},
			{ discrete: true },
		);
	});
});
