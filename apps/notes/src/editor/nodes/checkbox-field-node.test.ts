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
	$createCheckboxFieldNode,
	$isCheckboxFieldNode,
	CheckboxFieldNode,
	type SerializedCheckboxFieldNode,
} from "./checkbox-field-node";

function editorWithCheckbox(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "cb",
		nodes: [CheckboxFieldNode],
		onError: (e) => {
			throw e;
		},
	});
}

function seed(editor: LexicalEditor, checked: boolean): void {
	editor.update(
		() => {
			const para = $createParagraphNode();
			para.append($createCheckboxFieldNode(checked));
			$getRoot().append(para);
		},
		{ discrete: true },
	);
}

function firstField(): LexicalNode | null {
	const para = $getRoot().getFirstChild();
	return $isElementNode(para) ? para.getFirstChild() : null;
}

describe("CheckboxFieldNode", () => {
	it("serialises type / version / checked", () => {
		const editor = editorWithCheckbox();
		seed(editor, true);
		const root = editor.getEditorState().toJSON().root as unknown as {
			children: { children: SerializedCheckboxFieldNode[] }[];
		};
		const node = root.children[0]?.children[0];
		expect(node?.type).toBe("checkbox-field");
		expect(node?.version).toBe(1);
		expect(node?.checked).toBe(true);
	});

	it("defaults to unchecked", () => {
		const editor = editorWithCheckbox();
		seed(editor, false);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isCheckboxFieldNode(node) && node.isChecked()).toBe(false);
		});
	});

	it("setChecked flips the persisted state", () => {
		const editor = editorWithCheckbox();
		seed(editor, false);
		editor.update(
			() => {
				const node = firstField();
				if ($isCheckboxFieldNode(node)) node.setChecked(true);
			},
			{ discrete: true },
		);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isCheckboxFieldNode(node) && node.isChecked()).toBe(true);
		});
	});

	it("is inline and renders a GFM task marker as its plain-text view", () => {
		const editor = editorWithCheckbox();
		seed(editor, true);
		editor.getEditorState().read(() => {
			const node = firstField();
			if (!$isCheckboxFieldNode(node)) throw new Error("expected checkbox field");
			expect(node.isInline()).toBe(true);
			expect(node.getTextContent()).toBe("[x]");
		});
		const editor2 = editorWithCheckbox();
		seed(editor2, false);
		editor2.getEditorState().read(() => {
			const node = firstField();
			if (!$isCheckboxFieldNode(node)) throw new Error("expected checkbox field");
			expect(node.getTextContent()).toBe("[ ]");
		});
	});

	it("round-trips through serialize → parse", () => {
		const editor = editorWithCheckbox();
		seed(editor, true);
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const restored = editorWithCheckbox();
		restored.setEditorState(restored.parseEditorState(JSON.parse(json)));
		restored.getEditorState().read(() => {
			const node = firstField();
			expect($isCheckboxFieldNode(node)).toBe(true);
			if ($isCheckboxFieldNode(node)) expect(node.isChecked()).toBe(true);
		});
	});

	it("coerces a non-boolean imported `checked` to false", () => {
		const editor = editorWithCheckbox();
		editor.update(
			() => {
				const node = CheckboxFieldNode.importJSON({
					type: "checkbox-field",
					version: 1,
					checked: "yes",
				} as unknown as SerializedCheckboxFieldNode);
				expect(node.isChecked()).toBe(false);
			},
			{ discrete: true },
		);
	});
});
