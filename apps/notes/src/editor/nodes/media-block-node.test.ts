// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MEDIA_ALIGNMENT,
	DEFAULT_MEDIA_WIDTH_PERCENT,
	MAX_MEDIA_WIDTH_PERCENT,
	MIN_MEDIA_WIDTH_PERCENT,
	MediaAlignment,
	clampMediaWidth,
	isMediaAlignment,
} from "../media-types";
import {
	$createImageBlockNode,
	$isImageBlockNode,
	IMAGE_BLOCK_TYPE,
	ImageBlockNode,
	type SerializedImageBlockNode,
} from "./image-block-node";
import {
	$createVideoBlockNode,
	$isVideoBlockNode,
	type SerializedVideoBlockNode,
	VIDEO_BLOCK_TYPE,
	VideoBlockNode,
} from "./video-block-node";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [ImageBlockNode, VideoBlockNode],
		onError(error) {
			throw error;
		},
	});
}

const DISCRETE = { discrete: true } as const;

describe("media-types — width clamp + alignment guards", () => {
	it("clamps below min, above max, and rejects non-finite", () => {
		expect(clampMediaWidth(0)).toBe(MIN_MEDIA_WIDTH_PERCENT);
		expect(clampMediaWidth(-50)).toBe(MIN_MEDIA_WIDTH_PERCENT);
		expect(clampMediaWidth(150)).toBe(MAX_MEDIA_WIDTH_PERCENT);
		expect(clampMediaWidth(75)).toBe(75);
		expect(clampMediaWidth(Number.NaN)).toBe(DEFAULT_MEDIA_WIDTH_PERCENT);
		expect(clampMediaWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MEDIA_WIDTH_PERCENT);
	});

	it("rounds fractional widths to the nearest percent", () => {
		expect(clampMediaWidth(42.3)).toBe(42);
		expect(clampMediaWidth(42.7)).toBe(43);
	});

	it("accepts only declared MediaAlignment values", () => {
		expect(isMediaAlignment("left")).toBe(true);
		expect(isMediaAlignment("center")).toBe(true);
		expect(isMediaAlignment("right")).toBe(true);
		expect(isMediaAlignment("wide")).toBe(true);
		expect(isMediaAlignment("middle")).toBe(false);
		expect(isMediaAlignment(null)).toBe(false);
		expect(isMediaAlignment(undefined)).toBe(false);
		expect(isMediaAlignment(7)).toBe(false);
	});
});

describe("ImageBlockNode — fields + serialization", () => {
	it("defaults alignment to Center and width to 100", () => {
		const editor = createEditor();
		editor.update(() => {
			$getRoot().append($createImageBlockNode("brainstorm://app-file/x/y.png", "alt"));
		}, DISCRETE);
		editor.read(() => {
			const node = $getRoot().getFirstChild();
			expect($isImageBlockNode(node)).toBe(true);
			if (!$isImageBlockNode(node)) return;
			expect(node.getAlignment()).toBe(DEFAULT_MEDIA_ALIGNMENT);
			expect(node.getWidthPercent()).toBe(DEFAULT_MEDIA_WIDTH_PERCENT);
		});
	});

	it("setters mutate alignment + width and clamp", () => {
		const editor = createEditor();
		let key: string | null = null;
		editor.update(() => {
			const node = $createImageBlockNode("src");
			$getRoot().append(node);
			key = node.getKey();
		}, DISCRETE);
		editor.update(() => {
			const node = $getRoot().getFirstChild();
			if (!$isImageBlockNode(node)) throw new Error("expected image");
			node.setAlignment(MediaAlignment.Wide);
			node.setWidthPercent(220);
			node.setAlt("hello");
			node.setCaption("c");
		}, DISCRETE);
		editor.read(() => {
			const node = $getRoot().getFirstChild();
			if (!$isImageBlockNode(node)) throw new Error("expected image");
			expect(node.getAlignment()).toBe(MediaAlignment.Wide);
			expect(node.getWidthPercent()).toBe(MAX_MEDIA_WIDTH_PERCENT);
			expect(node.getAlt()).toBe("hello");
			expect(node.getCaption()).toBe("c");
			expect(key).toBe(node.getKey());
		});
	});

	it("exportJSON round-trips through importJSON at v2", () => {
		const editor = createEditor();
		editor.update(() => {
			$getRoot().append($createImageBlockNode("src", "alt", "cap", MediaAlignment.Right, 60));
		}, DISCRETE);
		let payload: SerializedImageBlockNode | null = null;
		editor.read(() => {
			const node = $getRoot().getFirstChild();
			if (!$isImageBlockNode(node)) throw new Error("expected image");
			payload = node.exportJSON();
		});
		const captured = payload as SerializedImageBlockNode | null;
		expect(captured).not.toBeNull();
		if (!captured) return;
		expect(captured.type).toBe(IMAGE_BLOCK_TYPE);
		expect(captured.version).toBe(2);
		expect(captured.alignment).toBe(MediaAlignment.Right);
		expect(captured.widthPercent).toBe(60);

		editor.update(() => {
			const restored = ImageBlockNode.importJSON(captured);
			expect(restored.getAlignment()).toBe(MediaAlignment.Right);
			expect(restored.getWidthPercent()).toBe(60);
			expect(restored.getAlt()).toBe("alt");
			expect(restored.getCaption()).toBe("cap");
		}, DISCRETE);
	});

	it("importJSON tolerates v1 payloads missing alignment + widthPercent", () => {
		const editor = createEditor();
		const legacy = {
			type: IMAGE_BLOCK_TYPE,
			version: 2 as const,
			src: "x",
			alt: "",
			caption: "",
		} as unknown as SerializedImageBlockNode;
		editor.update(() => {
			const node = ImageBlockNode.importJSON(legacy);
			expect(node.getAlignment()).toBe(DEFAULT_MEDIA_ALIGNMENT);
			expect(node.getWidthPercent()).toBe(DEFAULT_MEDIA_WIDTH_PERCENT);
		}, DISCRETE);
	});

	it("importJSON clamps malformed widthPercent and falls back on bad alignment", () => {
		const editor = createEditor();
		const dirty: SerializedImageBlockNode = {
			type: IMAGE_BLOCK_TYPE,
			version: 2,
			src: "x",
			alt: "",
			caption: "",
			alignment: "diagonal" as unknown as MediaAlignment,
			widthPercent: 999,
		};
		editor.update(() => {
			const node = ImageBlockNode.importJSON(dirty);
			expect(node.getAlignment()).toBe(DEFAULT_MEDIA_ALIGNMENT);
			expect(node.getWidthPercent()).toBe(MAX_MEDIA_WIDTH_PERCENT);
		}, DISCRETE);
	});

	it("clone preserves alignment + widthPercent", () => {
		const editor = createEditor();
		editor.update(() => {
			const original = new ImageBlockNode("src", "a", "c", MediaAlignment.Left, 40);
			const copy = ImageBlockNode.clone(original);
			expect(copy.getAlignment()).toBe(MediaAlignment.Left);
			expect(copy.getWidthPercent()).toBe(40);
			expect(copy.getAlt()).toBe("a");
			expect(copy.getCaption()).toBe("c");
		}, DISCRETE);
	});
});

describe("VideoBlockNode — fields + serialization", () => {
	it("defaults alignment + width and round-trips through importJSON at v2", () => {
		const editor = createEditor();
		editor.update(() => {
			const node = $createVideoBlockNode("src", "video/mp4", "cap", MediaAlignment.Right, 75);
			expect(node.getAlignment()).toBe(MediaAlignment.Right);
			expect(node.getWidthPercent()).toBe(75);
			const payload = node.exportJSON();
			expect(payload.type).toBe(VIDEO_BLOCK_TYPE);
			expect(payload.version).toBe(2);
			const restored = VideoBlockNode.importJSON(payload);
			expect(restored.getAlignment()).toBe(MediaAlignment.Right);
			expect(restored.getWidthPercent()).toBe(75);
			expect(restored.getMime()).toBe("video/mp4");
			expect(restored.getCaption()).toBe("cap");
		}, DISCRETE);
	});

	it("setters mutate alignment + width + caption inside an editor", () => {
		const editor = createEditor();
		editor.update(() => {
			$getRoot().append($createVideoBlockNode("src", "video/mp4"));
		}, DISCRETE);
		editor.update(() => {
			const node = $getRoot().getFirstChild();
			if (!$isVideoBlockNode(node)) throw new Error("expected video");
			node.setAlignment(MediaAlignment.Left);
			node.setWidthPercent(33.6);
			node.setCaption("clip");
		}, DISCRETE);
		editor.read(() => {
			const node = $getRoot().getFirstChild();
			if (!$isVideoBlockNode(node)) throw new Error("expected video");
			expect(node.getAlignment()).toBe(MediaAlignment.Left);
			expect(node.getWidthPercent()).toBe(34);
			expect(node.getCaption()).toBe("clip");
		});
	});

	it("clone preserves all media fields", () => {
		const editor = createEditor();
		editor.update(() => {
			const original = new VideoBlockNode("src", "video/webm", "cap", MediaAlignment.Wide, 100);
			const copy = VideoBlockNode.clone(original);
			expect(copy.getAlignment()).toBe(MediaAlignment.Wide);
			expect(copy.getWidthPercent()).toBe(100);
			expect(copy.getMime()).toBe("video/webm");
			expect(copy.getCaption()).toBe("cap");
		}, DISCRETE);
	});

	it("importJSON tolerates malformed alignment + widthPercent", () => {
		const editor = createEditor();
		const dirty: SerializedVideoBlockNode = {
			type: VIDEO_BLOCK_TYPE,
			version: 2,
			src: "x",
			mime: "",
			caption: "",
			alignment: "skewed" as unknown as MediaAlignment,
			widthPercent: -50,
		};
		editor.update(() => {
			const node = VideoBlockNode.importJSON(dirty);
			expect(node.getAlignment()).toBe(DEFAULT_MEDIA_ALIGNMENT);
			expect(node.getWidthPercent()).toBe(MIN_MEDIA_WIDTH_PERCENT);
		}, DISCRETE);
	});
});
