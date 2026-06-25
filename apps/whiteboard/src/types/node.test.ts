import { describe, expect, it } from "vitest";
import {
	type EmbeddedNode,
	type FrameNode,
	type GroupNode,
	IMAGE_FITS,
	ImageFit,
	type ImageNode,
	NODE_KINDS,
	NodeKind,
	STICKY_COLORS,
	StickyColor,
	type StickyNode,
	TEXT_BLOCK_FORMATS,
	TextBlockFormat,
	type TextNode,
	type WhiteboardNode,
	isEmbedded,
	isFrame,
	isGroup,
	isImage,
	isSticky,
	isText,
	stickyColorToCss,
} from "./node";

const base = { id: "n1", x: 0, y: 0, width: 100, height: 80 };

const sticky: StickyNode = { ...base, kind: NodeKind.Sticky, text: "hi", color: StickyColor.Blue };
const text: TextNode = {
	...base,
	kind: NodeKind.Text,
	text: "doc",
	format: TextBlockFormat.Heading,
};
const image: ImageNode = { ...base, kind: NodeKind.Image, imageUrl: "u", fit: ImageFit.Cover };
const frame: FrameNode = { ...base, kind: NodeKind.Frame, title: "F" };
const group: GroupNode = { ...base, kind: NodeKind.Group, memberIds: ["a"] };
const embedded: EmbeddedNode = { ...base, kind: NodeKind.Embedded, entityRef: "brainstorm://x" };

const ALL: WhiteboardNode[] = [sticky, text, image, frame, group, embedded];

describe("type guards discriminate exactly one kind", () => {
	const guards: Array<[(n: WhiteboardNode) => boolean, NodeKind]> = [
		[isSticky, NodeKind.Sticky],
		[isText, NodeKind.Text],
		[isImage, NodeKind.Image],
		[isFrame, NodeKind.Frame],
		[isGroup, NodeKind.Group],
		[isEmbedded, NodeKind.Embedded],
	];

	for (const [guard, kind] of guards) {
		it(`${guard.name} is true only for ${kind}`, () => {
			for (const n of ALL) {
				expect(guard(n)).toBe(n.kind === kind);
			}
		});
	}

	it("a guard narrows the union for the consumer", () => {
		const n: WhiteboardNode = sticky;
		if (isSticky(n)) expect(n.color).toBe(StickyColor.Blue);
		else throw new Error("guard failed to narrow");
	});
});

describe("stickyColorToCss", () => {
	it("is total over STICKY_COLORS and returns distinct hex strings", () => {
		const seen = new Set<string>();
		for (const c of STICKY_COLORS) {
			const css = stickyColorToCss(c);
			expect(css).toMatch(/^#[0-9a-f]{6}$/i);
			seen.add(css);
		}
		expect(seen.size).toBe(STICKY_COLORS.length);
	});
});

describe("frozen ordered arrays", () => {
	it("NODE_KINDS — frozen, length 8, correct order", () => {
		expect(Object.isFrozen(NODE_KINDS)).toBe(true);
		expect(NODE_KINDS).toEqual([
			NodeKind.Sticky,
			NodeKind.Text,
			NodeKind.Image,
			NodeKind.Embedded,
			NodeKind.Frame,
			NodeKind.Group,
			NodeKind.Shape,
			NodeKind.Ink,
		]);
	});

	it("STICKY_COLORS — frozen, length 6, correct order", () => {
		expect(Object.isFrozen(STICKY_COLORS)).toBe(true);
		expect(STICKY_COLORS).toEqual([
			StickyColor.Yellow,
			StickyColor.Green,
			StickyColor.Blue,
			StickyColor.Pink,
			StickyColor.Purple,
			StickyColor.Gray,
		]);
	});

	it("TEXT_BLOCK_FORMATS — frozen, length 3, correct order", () => {
		expect(Object.isFrozen(TEXT_BLOCK_FORMATS)).toBe(true);
		expect(TEXT_BLOCK_FORMATS).toEqual([
			TextBlockFormat.Plain,
			TextBlockFormat.Heading,
			TextBlockFormat.Quote,
		]);
	});

	it("IMAGE_FITS — frozen, length 3, correct order", () => {
		expect(Object.isFrozen(IMAGE_FITS)).toBe(true);
		expect(IMAGE_FITS).toEqual([ImageFit.Contain, ImageFit.Cover, ImageFit.Fill]);
	});
});
