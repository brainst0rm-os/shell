import { describe, expect, it } from "vitest";
import {
	ArrowHead,
	EdgeColor,
	EdgePathKind,
	HandleSide,
	type WhiteboardEdge,
	edgeColorToCss,
} from "../types/edge";
import {
	isBidirectional,
	setEdgeArrowHead,
	setEdgeBidirectional,
	setEdgeColor,
	setEdgeDashed,
	setEdgePathKind,
} from "./edge-style";

const edge = (id: string): WhiteboardEdge => ({
	id,
	whiteboardId: "wb",
	sourceNodeId: "a",
	sourceHandle: HandleSide.Right,
	destNodeId: "b",
	destHandle: HandleSide.Left,
	pathKind: EdgePathKind.Step,
	arrowHead: ArrowHead.Arrow,
	label: null,
	colorHint: null,
	createdAt: 1,
	updatedAt: 1,
});

const NOW = 1000;

describe("edge-style transforms", () => {
	it("setEdgePathKind patches the target edge + bumps updatedAt", () => {
		const edges = [edge("e1"), edge("e2")];
		const out = setEdgePathKind(edges, "e1", EdgePathKind.Bezier, NOW);
		expect(out[0]?.pathKind).toBe(EdgePathKind.Bezier);
		expect(out[0]?.updatedAt).toBe(NOW);
		// Other edges pass through by reference.
		expect(out[1]).toBe(edges[1]);
		// New object for the patched edge (immutable).
		expect(out[0]).not.toBe(edges[0]);
	});

	it("setEdgeArrowHead sets the dest arrowhead", () => {
		const out = setEdgeArrowHead([edge("e1")], "e1", ArrowHead.Diamond, NOW);
		expect(out[0]?.arrowHead).toBe(ArrowHead.Diamond);
	});

	it("returns the SAME array reference when the id is not found (no-op)", () => {
		const edges = [edge("e1")];
		expect(setEdgePathKind(edges, "missing", EdgePathKind.Straight, NOW)).toBe(edges);
		expect(setEdgeDashed(edges, "missing", true, NOW)).toBe(edges);
	});

	it("setEdgeBidirectional adds + removes the source arrowhead", () => {
		const on = setEdgeBidirectional([edge("e1")], "e1", true, NOW);
		expect(on[0]?.sourceArrowHead).toBe(ArrowHead.Arrow);
		expect(isBidirectional(on[0] as WhiteboardEdge)).toBe(true);
		// Turning it off deletes the key entirely (absent = unmarked source).
		const off = setEdgeBidirectional(on, "e1", false, NOW);
		expect("sourceArrowHead" in (off[0] as WhiteboardEdge)).toBe(false);
		expect(isBidirectional(off[0] as WhiteboardEdge)).toBe(false);
	});

	it("setEdgeDashed adds the flag when on and deletes it when off", () => {
		const on = setEdgeDashed([edge("e1")], "e1", true, NOW);
		expect(on[0]?.dashed).toBe(true);
		const off = setEdgeDashed(on, "e1", false, NOW);
		expect("dashed" in (off[0] as WhiteboardEdge)).toBe(false);
	});

	it("setEdgeColor writes the palette css (null for Default)", () => {
		const blue = setEdgeColor([edge("e1")], "e1", EdgeColor.Blue, NOW);
		expect(blue[0]?.colorHint).toBe(edgeColorToCss(EdgeColor.Blue));
		const def = setEdgeColor(blue, "e1", EdgeColor.Default, NOW);
		expect(def[0]?.colorHint).toBeNull();
	});
});
