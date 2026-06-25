import { $createCodeNode } from "@lexical/code";
import { $createLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import { createBrainstormHeadlessEditor } from "./headless";
import { $createImageNode } from "./image-node";

/** Append one of every baseline block to the root. */
function seedBaselineDoc(editor: ReturnType<typeof createBrainstormHeadlessEditor>): void {
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();

			const heading = $createHeadingNode("h1");
			heading.append($createTextNode("Title"));

			const para = $createParagraphNode();
			const bold = $createTextNode("bold");
			bold.toggleFormat("bold");
			para.append($createTextNode("plain "), bold);

			const quote = $createQuoteNode();
			quote.append($createTextNode("a quote"));

			const list = $createListNode("bullet");
			const li = $createListItemNode();
			li.append($createTextNode("item one"));
			list.append(li);

			const link = $createParagraphNode();
			const a = $createLinkNode("https://brainstorm.test");
			a.append($createTextNode("a link"));
			link.append(a);

			const code = $createCodeNode("ts");
			code.append($createTextNode("const x = 1;"));

			const figure = $createParagraphNode();
			figure.append($createImageNode({ src: "img://1", altText: "shot", caption: "cap", width: 320 }));

			root.append(heading, para, quote, list, link, code, figure);
		},
		{ discrete: true },
	);
}

describe("createBrainstormHeadlessEditor", () => {
	it("registers the baseline node set (every baseline node constructs + serializes)", () => {
		const editor = createBrainstormHeadlessEditor();
		seedBaselineDoc(editor);
		const json = editor.getEditorState().toJSON();
		const types = new Set<string>();
		const walk = (n: { type: string; children?: unknown }) => {
			types.add(n.type);
			if (Array.isArray(n.children))
				for (const c of n.children) walk(c as { type: string; children?: unknown });
		};
		walk(json.root as unknown as { type: string; children?: unknown });
		for (const t of ["heading", "paragraph", "quote", "list", "listitem", "link", "code", "image"])
			expect(types.has(t)).toBe(true);
	});

	it("round-trips the serialized state cleanly (toJSON → parse → toJSON)", () => {
		const editor = createBrainstormHeadlessEditor();
		seedBaselineDoc(editor);
		const first = editor.getEditorState().toJSON();

		const parsed = editor.parseEditorState(JSON.stringify(first));
		editor.setEditorState(parsed);
		const second = editor.getEditorState().toJSON();

		expect(second).toEqual(first);
	});

	it("preserves the ImageNode payload through the round-trip", () => {
		const editor = createBrainstormHeadlessEditor();
		seedBaselineDoc(editor);
		const json = JSON.stringify(editor.getEditorState().toJSON());
		expect(json).toContain('"type":"image"');
		expect(json).toContain('"src":"img://1"');
		expect(json).toContain('"caption":"cap"');
		expect(json).toContain('"width":320');
	});

	it("honours namespace + editable config", () => {
		const editor = createBrainstormHeadlessEditor({ namespace: "notes", editable: false });
		expect(editor._config.namespace).toBe("notes");
		expect(editor.isEditable()).toBe(false);
	});
});
