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
	$createNumberFieldNode,
	$isNumberFieldNode,
	NumberFieldNode,
	type SerializedNumberFieldNode,
} from "./number-field-node";

function editorWithNumber(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "nf",
		nodes: [NumberFieldNode],
		onError: (e) => {
			throw e;
		},
	});
}

function seed(editor: LexicalEditor, value: number | null): void {
	editor.update(
		() => {
			const para = $createParagraphNode();
			para.append($createNumberFieldNode(value));
			$getRoot().append(para);
		},
		{ discrete: true },
	);
}

function firstField(): LexicalNode | null {
	const para = $getRoot().getFirstChild();
	return $isElementNode(para) ? para.getFirstChild() : null;
}

describe("NumberFieldNode", () => {
	it("serialises type / version / value", () => {
		const editor = editorWithNumber();
		seed(editor, 42);
		const root = editor.getEditorState().toJSON().root as unknown as {
			children: { children: SerializedNumberFieldNode[] }[];
		};
		const node = root.children[0]?.children[0];
		expect(node?.type).toBe("number-field");
		expect(node?.version).toBe(1);
		expect(node?.value).toBe(42);
	});

	it("defaults to an empty value", () => {
		const editor = editorWithNumber();
		seed(editor, null);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isNumberFieldNode(node) && node.getValue()).toBe(null);
		});
	});

	it("preserves zero (not coerced to empty)", () => {
		const editor = editorWithNumber();
		seed(editor, 0);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isNumberFieldNode(node) && node.getValue()).toBe(0);
			if ($isNumberFieldNode(node)) expect(node.getTextContent()).toBe("0");
		});
	});

	it("setValue updates the persisted state", () => {
		const editor = editorWithNumber();
		seed(editor, null);
		editor.update(
			() => {
				const node = firstField();
				if ($isNumberFieldNode(node)) node.setValue(-3.5);
			},
			{ discrete: true },
		);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isNumberFieldNode(node) && node.getValue()).toBe(-3.5);
		});
	});

	it("is inline and renders the raw number as its plain-text view", () => {
		const editor = editorWithNumber();
		seed(editor, 1234.5);
		editor.getEditorState().read(() => {
			const node = firstField();
			if (!$isNumberFieldNode(node)) throw new Error("expected number field");
			expect(node.isInline()).toBe(true);
			expect(node.getTextContent()).toBe("1234.5");
		});
	});

	it("an empty field has an empty plain-text view", () => {
		const editor = editorWithNumber();
		seed(editor, null);
		editor.getEditorState().read(() => {
			const node = firstField();
			if (!$isNumberFieldNode(node)) throw new Error("expected number field");
			expect(node.getTextContent()).toBe("");
		});
	});

	it("round-trips through serialize → parse", () => {
		const editor = editorWithNumber();
		seed(editor, 99);
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const restored = editorWithNumber();
		restored.setEditorState(restored.parseEditorState(JSON.parse(json)));
		restored.getEditorState().read(() => {
			const node = firstField();
			expect($isNumberFieldNode(node)).toBe(true);
			if ($isNumberFieldNode(node)) expect(node.getValue()).toBe(99);
		});
	});

	it("clamps a non-finite / non-number imported value to empty", () => {
		const editor = editorWithNumber();
		editor.update(
			() => {
				for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "42", null, {}]) {
					const node = NumberFieldNode.importJSON({
						type: "number-field",
						version: 1,
						value: bad,
					} as unknown as SerializedNumberFieldNode);
					expect(node.getValue()).toBe(null);
				}
			},
			{ discrete: true },
		);
	});
});
