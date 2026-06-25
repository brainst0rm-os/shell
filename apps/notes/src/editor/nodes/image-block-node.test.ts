// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createImageBlockNode, $isImageBlockNode, ImageBlockNode } from "./image-block-node";

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
			ImageBlockNode,
		],
		onError(error) {
			throw error;
		},
	});
}

describe("ImageBlockNode", () => {
	it("creates with src / alt / caption (inside editor.update)", () => {
		const editor = createEditor();
		let result = { src: "", alt: "", caption: "" };
		editor.update(
			() => {
				const node = $createImageBlockNode("data:image/png;base64,abc", "alt", "caption");
				result = {
					src: node.getSrc(),
					alt: node.getAlt(),
					caption: node.getCaption(),
				};
			},
			{ discrete: true },
		);
		expect(result).toEqual({ src: "data:image/png;base64,abc", alt: "alt", caption: "caption" });
	});

	it("$isImageBlockNode discriminates", () => {
		const editor = createEditor();
		let isImage = false;
		editor.update(
			() => {
				isImage = $isImageBlockNode($createImageBlockNode("x"));
			},
			{ discrete: true },
		);
		expect(isImage).toBe(true);
		expect($isImageBlockNode(null)).toBe(false);
		expect($isImageBlockNode(undefined)).toBe(false);
	});

	it("round-trips through exportJSON → importJSON", () => {
		const editor = createEditor();
		let json: ReturnType<ImageBlockNode["exportJSON"]> | null = null;
		let restored: { src: string; alt: string; caption: string } | null = null;
		editor.update(
			() => {
				const original = $createImageBlockNode("src", "alt-text", "a caption");
				json = original.exportJSON();
				const back = ImageBlockNode.importJSON(json);
				restored = {
					src: back.getSrc(),
					alt: back.getAlt(),
					caption: back.getCaption(),
				};
			},
			{ discrete: true },
		);
		const captured = json as ReturnType<ImageBlockNode["exportJSON"]> | null;
		expect(captured?.type).toBe("image-block");
		expect(captured?.version).toBe(2);
		expect(restored).toEqual({ src: "src", alt: "alt-text", caption: "a caption" });
	});

	it("appends as a top-level block in an editor", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createImageBlockNode("img.png", "alt", "cap"));
			},
			{ discrete: true },
		);
		let foundType = "";
		editor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			foundType = first?.getType() ?? "";
		});
		expect(foundType).toBe("image-block");
	});

	it("preserves type when restored from a serialized snapshot", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createImageBlockNode("a.png"));
			},
			{ discrete: true },
		);
		const snapshot = editor.getEditorState().toJSON();
		const otherEditor = createEditor();
		const state = otherEditor.parseEditorState(JSON.stringify(snapshot));
		otherEditor.setEditorState(state);
		let firstType = "";
		let firstSrc = "";
		otherEditor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			if ($isImageBlockNode(first)) {
				firstType = first.getType();
				firstSrc = first.getSrc();
			}
		});
		expect(firstType).toBe("image-block");
		expect(firstSrc).toBe("a.png");
	});
});
