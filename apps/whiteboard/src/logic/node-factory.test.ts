import { describe, expect, it } from "vitest";
import {
	ImageFit,
	NodeKind,
	ShapeKind,
	StickyColor,
	TextBlockFormat,
	isEmbedded,
	isFrame,
	isGroup,
	isImage,
	isShape,
	isSticky,
	isText,
} from "../types/node";
import {
	createEmbeddedNode,
	createFrameNode,
	createGroupNode,
	createImageNode,
	createShapeNode,
	createStickyNode,
	createTextNode,
	newNodeId,
} from "./node-factory";

describe("newNodeId", () => {
	it("returns a prefixed, unique id each call", () => {
		const a = newNodeId();
		const b = newNodeId();
		expect(a).toMatch(/^wbn_[a-z0-9]+_[a-z0-9]+$/);
		expect(a).not.toBe(b);
	});
});

describe("createStickyNode", () => {
	it("builds a valid Sticky with yellow default and the placement point", () => {
		const n = createStickyNode({ x: 40, y: 70 });
		expect(isSticky(n)).toBe(true);
		expect(n.kind).toBe(NodeKind.Sticky);
		expect(n).toMatchObject({ x: 40, y: 70, text: "", color: StickyColor.Yellow });
		expect(n.width).toBeGreaterThan(0);
		expect(n.height).toBeGreaterThan(0);
		expect(n.id).toMatch(/^wbn_/);
	});
});

describe("createEmbeddedNode", () => {
	it("builds a valid Embedded node carrying the ref + type at the point", () => {
		const n = createEmbeddedNode({ x: 12, y: 34 }, "brainstorm://entity/abc", "Task/v1");
		expect(isEmbedded(n)).toBe(true);
		expect(n.kind).toBe(NodeKind.Embedded);
		expect(n).toMatchObject({
			x: 12,
			y: 34,
			entityRef: "brainstorm://entity/abc",
			entityType: "Task/v1",
		});
		expect(n.width).toBeGreaterThan(0);
		expect(n.height).toBeGreaterThan(0);
		expect(n.id).toMatch(/^wbn_/);
	});
});

describe("createTextNode", () => {
	it("builds a valid Plain Text node at the point", () => {
		const n = createTextNode({ x: 10, y: 20 });
		expect(isText(n)).toBe(true);
		expect(n).toMatchObject({ x: 10, y: 20, text: "", format: TextBlockFormat.Plain });
	});
});

describe("createImageNode", () => {
	it("builds a valid Contain Image node carrying the url", () => {
		const n = createImageNode({ x: 5, y: 5 }, "https://example.test/a.png");
		expect(isImage(n)).toBe(true);
		expect(n).toMatchObject({ imageUrl: "https://example.test/a.png", fit: ImageFit.Contain });
		expect(n.width).toBeGreaterThan(0);
	});
});

describe("createFrameNode", () => {
	it("builds a valid empty-title Frame", () => {
		const n = createFrameNode({ x: 0, y: 0 });
		expect(isFrame(n)).toBe(true);
		expect(n).toMatchObject({ title: "", colorHint: null });
		expect(n.width).toBeGreaterThan(n.height === 0 ? 1 : 0);
	});
});

describe("createGroupNode", () => {
	it("builds a Group copying (not aliasing) the member ids", () => {
		const ids = ["a", "b"];
		const n = createGroupNode(ids);
		expect(isGroup(n)).toBe(true);
		expect(n.memberIds).toEqual(["a", "b"]);
		expect(n.memberIds).not.toBe(ids);
		ids.push("c");
		expect(n.memberIds).toEqual(["a", "b"]);
	});

	it("tolerates an empty membership", () => {
		const n = createGroupNode([]);
		expect(n.memberIds).toEqual([]);
		expect(n.kind).toBe(NodeKind.Group);
	});
});

describe("createShapeNode", () => {
	it("builds a rectangle at the point with a fill colour", () => {
		const n = createShapeNode({ x: 10, y: 20 }, ShapeKind.Rectangle);
		expect(isShape(n)).toBe(true);
		expect(n.kind).toBe(NodeKind.Shape);
		expect(n.shape).toBe(ShapeKind.Rectangle);
		expect(n.x).toBe(10);
		expect(n.y).toBe(20);
		expect(n.width).toBeGreaterThan(0);
		expect(n.height).toBeGreaterThan(0);
		expect(Object.values(StickyColor)).toContain(n.color);
	});

	it("builds an ellipse with the requested geometry", () => {
		const n = createShapeNode({ x: 0, y: 0 }, ShapeKind.Ellipse);
		expect(n.shape).toBe(ShapeKind.Ellipse);
	});
});
