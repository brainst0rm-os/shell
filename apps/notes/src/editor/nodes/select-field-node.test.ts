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
	$createSelectFieldNode,
	$isSelectFieldNode,
	SelectFieldNode,
	type SerializedSelectFieldNode,
} from "./select-field-node";

function editorWithSelect(): LexicalEditor {
	return createHeadlessEditor({
		namespace: "sf",
		nodes: [SelectFieldNode],
		onError: (e) => {
			throw e;
		},
	});
}

function seed(editor: LexicalEditor, options: readonly string[], value: string | null): void {
	editor.update(
		() => {
			const para = $createParagraphNode();
			para.append($createSelectFieldNode(options, value));
			$getRoot().append(para);
		},
		{ discrete: true },
	);
}

function firstField(): LexicalNode | null {
	const para = $getRoot().getFirstChild();
	return $isElementNode(para) ? para.getFirstChild() : null;
}

function mutate(editor: LexicalEditor, fn: (node: SelectFieldNode) => void): void {
	editor.update(
		() => {
			const node = firstField();
			if ($isSelectFieldNode(node)) fn(node);
		},
		{ discrete: true },
	);
}

describe("SelectFieldNode", () => {
	it("serialises type / version / options / value", () => {
		const editor = editorWithSelect();
		seed(editor, ["To do", "Done"], "Done");
		const root = editor.getEditorState().toJSON().root as unknown as {
			children: { children: SerializedSelectFieldNode[] }[];
		};
		const node = root.children[0]?.children[0];
		expect(node?.type).toBe("select-field");
		expect(node?.version).toBe(1);
		expect(node?.options).toEqual(["To do", "Done"]);
		expect(node?.value).toBe("Done");
	});

	it("defaults to no options and no value", () => {
		const editor = editorWithSelect();
		seed(editor, [], null);
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isSelectFieldNode(node) && node.getValue()).toBe(null);
			if ($isSelectFieldNode(node)) {
				expect(node.getOptions()).toEqual([]);
				expect(node.getTextContent()).toBe("");
			}
		});
	});

	it("setValue only accepts a value that's in the option set", () => {
		const editor = editorWithSelect();
		seed(editor, ["A", "B"], null);
		mutate(editor, (n) => n.setValue("A"));
		mutate(editor, (n) => n.setValue("C")); // not an option → cleared
		editor.getEditorState().read(() => {
			const node = firstField();
			expect($isSelectFieldNode(node) && node.getValue()).toBe(null);
		});
	});

	it("addOption de-dupes and returns the stored label; getTextContent is the picked label", () => {
		const editor = editorWithSelect();
		seed(editor, ["A"], null);
		mutate(editor, (n) => {
			expect(n.addOption("  B  ")).toBe("B"); // trimmed
			expect(n.addOption("A")).toBe("A"); // already present, no dup
			n.setValue("B");
		});
		editor.getEditorState().read(() => {
			const node = firstField();
			if ($isSelectFieldNode(node)) {
				expect(node.getOptions()).toEqual(["A", "B"]);
				expect(node.getTextContent()).toBe("B");
			}
		});
	});

	it("removeOption drops the option and clears the value if it was selected", () => {
		const editor = editorWithSelect();
		seed(editor, ["A", "B"], "B");
		mutate(editor, (n) => n.removeOption("B"));
		editor.getEditorState().read(() => {
			const node = firstField();
			if ($isSelectFieldNode(node)) {
				expect(node.getOptions()).toEqual(["A"]);
				expect(node.getValue()).toBe(null);
			}
		});
	});

	it("clamps malformed serialized payloads (non-string options, control chars, out-of-set value)", () => {
		const editor = editorWithSelect();
		seed(editor, ["ok"], null);
		const json = editor.getEditorState().toJSON() as unknown as {
			root: { children: { children: SerializedSelectFieldNode[] }[] };
		};
		const field = json.root.children[0]?.children[0];
		if (!field) throw new Error("seed missing field");
		// dup + non-string + blank + zero-width-only, plus a zero-width inside a label
		field.options = ["ok", "ok", 42, "", "  ", "a​b"] as unknown as string[];
		field.value = "ghost"; // not an option

		const clone = createHeadlessEditor({
			namespace: "sf-clamp",
			nodes: [SelectFieldNode],
			onError: (e) => {
				throw e;
			},
		});
		clone.setEditorState(clone.parseEditorState(json as never));
		clone.getEditorState().read(() => {
			const para = $getRoot().getFirstChild();
			const node = $isElementNode(para) ? para.getFirstChild() : null;
			if ($isSelectFieldNode(node)) {
				expect(node.getOptions()).toEqual(["ok", "ab"]); // dedup + drop non-string/blank, strip zero-width
				expect(node.getValue()).toBe(null);
			} else {
				throw new Error("clone missing select field");
			}
		});
	});

	it("round-trips through import/export", () => {
		const editor = editorWithSelect();
		seed(editor, ["X", "Y"], "Y");
		const json = editor.getEditorState().toJSON();
		const clone = createHeadlessEditor({
			namespace: "sf2",
			nodes: [SelectFieldNode],
			onError: (e) => {
				throw e;
			},
		});
		clone.setEditorState(clone.parseEditorState(json));
		clone.getEditorState().read(() => {
			const para = $getRoot().getFirstChild();
			const node = $isElementNode(para) ? para.getFirstChild() : null;
			if ($isSelectFieldNode(node)) {
				expect(node.getOptions()).toEqual(["X", "Y"]);
				expect(node.getValue()).toBe("Y");
			}
		});
	});
});
