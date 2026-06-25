// @vitest-environment jsdom
import { CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { ImageBlockNode } from "./image-block-node";
import { $createVideoBlockNode, $isVideoBlockNode, VideoBlockNode } from "./video-block-node";

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
			VideoBlockNode,
		],
		onError(error) {
			throw error;
		},
	});
}

describe("VideoBlockNode", () => {
	it("creates with src / mime / caption (inside editor.update)", () => {
		const editor = createEditor();
		let result = { src: "", mime: "", caption: "" };
		editor.update(
			() => {
				const node = $createVideoBlockNode("brainstorm://app-file/x/y.mp4", "video/mp4", "clip");
				result = {
					src: node.getSrc(),
					mime: node.getMime(),
					caption: node.getCaption(),
				};
			},
			{ discrete: true },
		);
		expect(result).toEqual({
			src: "brainstorm://app-file/x/y.mp4",
			mime: "video/mp4",
			caption: "clip",
		});
	});

	it("$isVideoBlockNode discriminates", () => {
		const editor = createEditor();
		let isVideo = false;
		let imageIsVideo = false;
		editor.update(
			() => {
				isVideo = $isVideoBlockNode($createVideoBlockNode("src.mp4"));
				imageIsVideo = $isVideoBlockNode(null);
			},
			{ discrete: true },
		);
		expect(isVideo).toBe(true);
		expect(imageIsVideo).toBe(false);
		expect($isVideoBlockNode(undefined)).toBe(false);
	});

	it("round-trips through exportJSON → importJSON", () => {
		const editor = createEditor();
		let json: ReturnType<VideoBlockNode["exportJSON"]> | null = null;
		let restored: { src: string; mime: string; caption: string } | null = null;
		editor.update(
			() => {
				const original = $createVideoBlockNode("a.mp4", "video/mp4", "demo");
				json = original.exportJSON();
				const back = VideoBlockNode.importJSON(json);
				restored = {
					src: back.getSrc(),
					mime: back.getMime(),
					caption: back.getCaption(),
				};
			},
			{ discrete: true },
		);
		const captured = json as ReturnType<VideoBlockNode["exportJSON"]> | null;
		expect(captured?.type).toBe("video-block");
		expect(captured?.version).toBe(2);
		expect(restored).toEqual({ src: "a.mp4", mime: "video/mp4", caption: "demo" });
	});

	it("preserves type when restored from a serialized snapshot", () => {
		const editor = createEditor();
		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createVideoBlockNode("clip.webm", "video/webm"));
			},
			{ discrete: true },
		);
		const snapshot = editor.getEditorState().toJSON();
		const otherEditor = createEditor();
		const state = otherEditor.parseEditorState(JSON.stringify(snapshot));
		otherEditor.setEditorState(state);
		let firstType = "";
		let firstSrc = "";
		let firstMime = "";
		otherEditor.getEditorState().read(() => {
			const first = $getRoot().getFirstChild();
			if ($isVideoBlockNode(first)) {
				firstType = first.getType();
				firstSrc = first.getSrc();
				firstMime = first.getMime();
			}
		});
		expect(firstType).toBe("video-block");
		expect(firstSrc).toBe("clip.webm");
		expect(firstMime).toBe("video/webm");
	});
});
