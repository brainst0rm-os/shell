import { describe, expect, it } from "vitest";
import { ArrowHead, EdgePathKind, HandleSide, type WhiteboardEdge } from "../types/edge";
import { NodeKind, StickyColor, TextBlockFormat, type WhiteboardNode } from "../types/node";
import type { Whiteboard } from "../types/whiteboard";
import { WhiteboardExportFormat, exportWhiteboard, toJSON, toSVG } from "./whiteboard-export";

const sticky = (id: string, x: number, y: number, text = "Note"): WhiteboardNode => ({
	id,
	kind: NodeKind.Sticky,
	x,
	y,
	width: 120,
	height: 80,
	text,
	color: StickyColor.Yellow,
});

const board = (nodes: WhiteboardNode[]): Whiteboard => ({
	id: "wb1",
	name: "Board",
	nodes,
	createdAt: 0,
	updatedAt: 0,
});

const edge = (
	over: Partial<WhiteboardEdge> & Pick<WhiteboardEdge, "sourceNodeId" | "destNodeId">,
): WhiteboardEdge => ({
	id: "e1",
	whiteboardId: "wb1",
	sourceHandle: HandleSide.Right,
	destHandle: HandleSide.Left,
	pathKind: EdgePathKind.Straight,
	arrowHead: ArrowHead.Arrow,
	label: null,
	colorHint: null,
	createdAt: 0,
	updatedAt: 0,
	...over,
});

describe("toJSON", () => {
	it("emits the versioned model + edges", () => {
		const doc = JSON.parse(
			toJSON(board([sticky("a", 0, 0)]), [edge({ sourceNodeId: "a", destNodeId: "a" })]),
		);
		expect(doc.format).toBe("brainstorm/whiteboard-export/v1");
		expect(doc.board.id).toBe("wb1");
		expect(doc.board.nodes[0].id).toBe("a");
		expect(doc.edges[0].id).toBe("e1");
	});
});

describe("toSVG", () => {
	it("is a well-formed svg with an auto-fit padded viewBox + arrow marker def", () => {
		const svg = toSVG(board([sticky("a", 10, 20)]), []);
		expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		// node bbox = (10,20)-(130,100); pad 40 → viewBox="-30 -20 200 160".
		expect(svg).toContain('viewBox="-30 -20 200 160"');
		expect(svg).toContain('<marker id="wb-arrow"');
		expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
	});

	it("draws a sticky as a tinted rect with its (escaped) text", () => {
		const svg = toSVG(board([sticky("a", 0, 0, "A & <B>")]), []);
		expect(svg).toContain('<rect x="0" y="0" width="120" height="80" rx="6"');
		expect(svg).toContain(">A &amp; &lt;B&gt;</text>");
	});

	it("draws an ink stroke as a polyline mapping the normalised path into the box (9.17.9)", () => {
		const ink: WhiteboardNode = {
			id: "k",
			kind: NodeKind.Ink,
			x: 100,
			y: 100,
			width: 200,
			height: 50,
			points: [
				{ x: 0, y: 0 },
				{ x: 50, y: 100 },
				{ x: 100, y: 0 },
			],
			color: StickyColor.Gray,
		};
		const svg = toSVG(board([ink]), []);
		// 0..100 normalised → box: (100,100) (200,150) (300,100).
		expect(svg).toContain('<polyline points="100,100 200,150 300,100" fill="none"');
		// Not rendered as a rect (it has no fill plate).
		expect(svg).not.toContain('<rect x="100" y="100"');
	});

	it("clamps an over-long label to roughly the box width", () => {
		const svg = toSVG(board([sticky("a", 0, 0, "x".repeat(400))]), []);
		const m = svg.match(/>(x+…)</);
		expect(m).not.toBeNull();
		expect(m?.[1]?.length ?? 999).toBeLessThan(40); // 120/7 ≈ 17 chars + …
	});

	it("renders an edge as a path with the arrow marker, under the nodes", () => {
		const svg = toSVG(board([sticky("a", 0, 0), sticky("b", 300, 0)]), [
			edge({ sourceNodeId: "a", destNodeId: "b" }),
		]);
		expect(svg).toContain('marker-end="url(#wb-arrow)"');
		expect(svg.indexOf("<path")).toBeLessThan(svg.indexOf("<rect"));
	});

	it("omits the arrow marker when arrowHead is None and draws the edge label", () => {
		const svg = toSVG(board([sticky("a", 0, 0), sticky("b", 300, 0)]), [
			edge({ sourceNodeId: "a", destNodeId: "b", arrowHead: ArrowHead.None, label: "rel" }),
		]);
		expect(svg).not.toContain("marker-end=");
		expect(svg).toContain(">rel</text>");
	});

	it("skips a dangling edge (endpoint node missing)", () => {
		const svg = toSVG(board([sticky("a", 0, 0)]), [edge({ sourceNodeId: "a", destNodeId: "ghost" })]);
		// The only <path> is the arrow-marker def — no edge path is emitted.
		expect(svg.match(/<path/g)?.length).toBe(1);
		expect(svg).not.toContain('stroke-width="2"');
	});

	it("z-orders nodes (higher zIndex paints later / on top)", () => {
		const lo = { ...sticky("lo", 0, 0, "LO"), zIndex: 1 };
		const hi = { ...sticky("hi", 0, 0, "HI"), zIndex: 5 };
		const svg = toSVG(board([hi, lo]), []); // declared hi-first, but zIndex wins
		expect(svg.indexOf(">LO<")).toBeLessThan(svg.indexOf(">HI<"));
	});

	it("a Text-heading node uses a larger font and no fill plate", () => {
		const heading: WhiteboardNode = {
			id: "t",
			kind: NodeKind.Text,
			x: 0,
			y: 0,
			width: 200,
			height: 40,
			text: "Title",
			format: TextBlockFormat.Heading,
		};
		const svg = toSVG(board([heading]), []);
		expect(svg).toContain('font-size="16"');
		expect(svg).not.toContain("<rect"); // Text has no fill/stroke
	});

	it("empty board → minimal valid 1×1 svg", () => {
		const svg = toSVG(board([]), []);
		expect(svg).toContain('viewBox="0 0 1 1"');
		expect(svg).not.toContain("<rect");
		expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
	});
});

describe("exportWhiteboard dispatch", () => {
	it("routes to JSON / SVG", () => {
		const b = board([sticky("a", 0, 0)]);
		expect(exportWhiteboard(b, [], WhiteboardExportFormat.Json)).toBe(toJSON(b, []));
		expect(exportWhiteboard(b, [], WhiteboardExportFormat.Svg)).toBe(toSVG(b, []));
	});
});
