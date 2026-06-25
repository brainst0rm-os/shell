// @vitest-environment jsdom
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createTitleNode, $isTitleNode, TitleNode } from "../nodes/title-node";
import { enforceTitleInvariant } from "./title-plugin";

function makeEditor() {
	return createEditor({
		namespace: "title-test",
		nodes: [TitleNode],
		onError: (e) => {
			throw e;
		},
	});
}

function titleCount(editor: ReturnType<typeof createEditor>): number {
	return editor.getEditorState().read(
		() =>
			$getRoot()
				.getChildren()
				.filter((n) => $isTitleNode(n)).length,
	);
}

describe("enforceTitleInvariant", () => {
	it("seeds a title + paragraph into an empty root", () => {
		const editor = makeEditor();
		editor.update(
			() => {
				enforceTitleInvariant($getRoot());
			},
			{ discrete: true },
		);
		expect(titleCount(editor)).toBe(1);
		const firstIsTitle = editor.getEditorState().read(() => $isTitleNode($getRoot().getFirstChild()));
		expect(firstIsTitle).toBe(true);
	});

	it("prepends a title when the first child isn't one", () => {
		const editor = makeEditor();
		editor.update(
			() => {
				const p = $createParagraphNode();
				p.append($createTextNode("body"));
				$getRoot().append(p);
				enforceTitleInvariant($getRoot());
			},
			{ discrete: true },
		);
		expect(titleCount(editor)).toBe(1);
	});

	it("demotes a SECOND title (drag-above / paste) to a paragraph, keeping its text", () => {
		const editor = makeEditor();
		editor.update(
			() => {
				const root = $getRoot();
				const t1 = $createTitleNode();
				t1.append($createTextNode("Real Title"));
				const t2 = $createTitleNode();
				t2.append($createTextNode("Sneaky Second Title"));
				root.append(t1, t2);
				enforceTitleInvariant(root);
			},
			{ discrete: true },
		);
		expect(titleCount(editor)).toBe(1);
		const text = editor.getEditorState().read(() => $getRoot().getTextContent());
		// The second title's text survives, just demoted to body.
		expect(text).toContain("Real Title");
		expect(text).toContain("Sneaky Second Title");
	});

	it("collapses [paragraph, title] (title dragged below) to a single leading title", () => {
		const editor = makeEditor();
		editor.update(
			() => {
				const root = $getRoot();
				const p = $createParagraphNode();
				p.append($createTextNode("moved up"));
				const t = $createTitleNode();
				t.append($createTextNode("was the title"));
				root.append(p, t);
				// Re-run until stable, like Lexical does.
				enforceTitleInvariant(root);
				enforceTitleInvariant(root);
			},
			{ discrete: true },
		);
		expect(titleCount(editor)).toBe(1);
		const firstIsTitle = editor.getEditorState().read(() => $isTitleNode($getRoot().getFirstChild()));
		expect(firstIsTitle).toBe(true);
	});
});
