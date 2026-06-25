import { describe, expect, it } from "vitest";
import { ArrowHead, EdgePathKind, HandleSide, type WhiteboardEdge } from "../types/edge";
import { NodeKind, StickyColor, type WhiteboardNode } from "../types/node";
import {
	type EdgeRenderInput,
	cssColorToNumber,
	edgePolyline,
	nearestEdgeId,
	pointSegmentDistSq,
} from "./edge-geometry";

function node(
	over: Pick<WhiteboardNode, "id"> & Partial<Pick<WhiteboardNode, "x" | "y" | "width" | "height">>,
): WhiteboardNode {
	return {
		id: over.id,
		kind: NodeKind.Sticky,
		x: over.x ?? 0,
		y: over.y ?? 0,
		width: over.width ?? 100,
		height: over.height ?? 60,
		text: "",
		color: StickyColor.Yellow,
	};
}

function edge(over: Partial<WhiteboardEdge> & Pick<WhiteboardEdge, "id">): WhiteboardEdge {
	return {
		id: over.id,
		whiteboardId: "wb",
		sourceNodeId: over.sourceNodeId ?? "a",
		sourceHandle: over.sourceHandle ?? HandleSide.Right,
		destNodeId: over.destNodeId ?? "b",
		destHandle: over.destHandle ?? HandleSide.Left,
		pathKind: over.pathKind ?? EdgePathKind.Straight,
		arrowHead: over.arrowHead ?? ArrowHead.Arrow,
		label: over.label ?? null,
		colorHint: over.colorHint ?? null,
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("cssColorToNumber", () => {
	it("parses #rrggbb", () => {
		expect(cssColorToNumber("#a78bfa", 0)).toBe(0xa78bfa);
	});

	it("parses #rgb shorthand", () => {
		expect(cssColorToNumber("#fff", 0)).toBe(0xffffff);
		expect(cssColorToNumber("#0a0", 0)).toBe(0x00aa00);
	});

	it("parses rgb()/rgba() and drops alpha", () => {
		expect(cssColorToNumber("rgb(255, 0, 128)", 0)).toBe(0xff0080);
		expect(cssColorToNumber("rgba(16, 32, 48, 0.4)", 0)).toBe(0x102030);
	});

	it("clamps out-of-range channels", () => {
		expect(cssColorToNumber("rgb(999, -5, 300)", 0)).toBe(0xff00ff);
	});

	it("returns the fallback for unparseable input (fail-open)", () => {
		expect(cssColorToNumber("var(--edge)", 0x123456)).toBe(0x123456);
		expect(cssColorToNumber("#zz", 0x654321)).toBe(0x654321);
		expect(cssColorToNumber("", 0x111)).toBe(0x111);
	});
});

describe("pointSegmentDistSq", () => {
	it("is 0 on the segment", () => {
		expect(pointSegmentDistSq({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
	});

	it("is the perpendicular distance squared off the middle", () => {
		expect(pointSegmentDistSq({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
	});

	it("clamps to the endpoints past the segment ends", () => {
		expect(pointSegmentDistSq({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(16);
		expect(pointSegmentDistSq({ x: 13, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
	});

	it("handles a degenerate zero-length segment", () => {
		expect(pointSegmentDistSq({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(25);
	});
});

describe("edgePolyline", () => {
	const a = node({ id: "a", x: 0, y: 0, width: 100, height: 100 });
	const b = node({ id: "b", x: 300, y: 0, width: 100, height: 100 });

	it("straight = the two handle endpoints", () => {
		const poly = edgePolyline({
			edge: edge({ id: "e", pathKind: EdgePathKind.Straight }),
			source: a,
			dest: b,
		});
		expect(poly).toHaveLength(2);
		// right handle of a (x=100, y=50) → left handle of b (x=300, y=50)
		expect(poly[0]).toEqual({ x: 100, y: 50 });
		expect(poly[1]).toEqual({ x: 300, y: 50 });
	});

	it("bezier is flattened to a multi-point polyline through the endpoints", () => {
		const poly = edgePolyline({
			edge: edge({ id: "e", pathKind: EdgePathKind.Bezier }),
			source: a,
			dest: b,
		});
		expect(poly.length).toBeGreaterThan(2);
		expect(poly[0]).toEqual({ x: 100, y: 50 });
		expect(poly[poly.length - 1]).toEqual({ x: 300, y: 50 });
	});

	it("step routes around the node boxes (>2 points)", () => {
		const poly = edgePolyline({
			edge: edge({ id: "e", pathKind: EdgePathKind.Step }),
			source: a,
			dest: b,
		});
		expect(poly.length).toBeGreaterThanOrEqual(2);
		expect(poly[0]).toEqual({ x: 100, y: 50 });
		expect(poly[poly.length - 1]).toEqual({ x: 300, y: 50 });
	});
});

describe("nearestEdgeId", () => {
	const a = node({ id: "a", x: 0, y: 0, width: 100, height: 100 });
	const b = node({ id: "b", x: 300, y: 0, width: 100, height: 100 });
	const inputs: EdgeRenderInput[] = [
		{ edge: edge({ id: "e1", pathKind: EdgePathKind.Straight }), source: a, dest: b },
	];

	it("returns the edge id when the point is within tolerance of the line", () => {
		expect(nearestEdgeId(inputs, { x: 200, y: 52 }, 10)).toBe("e1");
	});

	it("returns null when the point is too far from any edge", () => {
		expect(nearestEdgeId(inputs, { x: 200, y: 200 }, 10)).toBeNull();
	});

	it("returns null for an empty scene", () => {
		expect(nearestEdgeId([], { x: 0, y: 0 }, 10)).toBeNull();
	});
});
