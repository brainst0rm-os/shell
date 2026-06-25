import { describe, expect, it } from "vitest";
import { NodeKind, StickyColor, type WhiteboardNode } from "../types/node";
import { ZOrderOp, computeZOrder } from "./z-order";

function node(id: string, zIndex?: number): WhiteboardNode {
	return {
		id,
		kind: NodeKind.Sticky,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		text: id,
		color: StickyColor.Yellow,
		...(zIndex !== undefined ? { zIndex } : {}),
	};
}

// a,b,c,d stacked bottom→top (z 0,1,2,3).
const NODES = [node("a", 0), node("b", 1), node("c", 2), node("d", 3)];
const sel = (...ids: string[]) => new Set(ids);
/** Resolve the computed map to the stacking order (bottom→top) of ids. */
function orderOf(nodes: WhiteboardNode[], map: Map<string, number>): string[] {
	return [...nodes].sort((x, y) => (map.get(x.id) ?? 0) - (map.get(y.id) ?? 0)).map((n) => n.id);
}

describe("computeZOrder", () => {
	it("empty selection is a no-op", () => {
		expect(computeZOrder(NODES, sel(), ZOrderOp.ToFront).size).toBe(0);
	});

	it("ToFront jumps the selection above everything, keeping internal order", () => {
		const map = computeZOrder(NODES, sel("a", "b"), ZOrderOp.ToFront);
		expect(orderOf(NODES, map)).toEqual(["c", "d", "a", "b"]);
	});

	it("ToBack drops the selection below everything", () => {
		const map = computeZOrder(NODES, sel("c", "d"), ZOrderOp.ToBack);
		expect(orderOf(NODES, map)).toEqual(["c", "d", "a", "b"]);
	});

	it("Forward steps the selection up one layer past an unselected neighbour", () => {
		const map = computeZOrder(NODES, sel("b"), ZOrderOp.Forward);
		expect(orderOf(NODES, map)).toEqual(["a", "c", "b", "d"]);
	});

	it("Backward steps the selection down one layer", () => {
		const map = computeZOrder(NODES, sel("c"), ZOrderOp.Backward);
		expect(orderOf(NODES, map)).toEqual(["a", "c", "b", "d"]);
	});

	it("Forward on the top node is a no-op (nothing above)", () => {
		const map = computeZOrder(NODES, sel("d"), ZOrderOp.Forward);
		expect(orderOf(NODES, map)).toEqual(["a", "b", "c", "d"]);
	});

	it("densifies z to 0..n-1 for every node", () => {
		const map = computeZOrder(NODES, sel("a"), ZOrderOp.ToFront);
		expect([...map.values()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
	});

	it("treats absent zIndex as 0 (document order tiebreak)", () => {
		const nodes = [node("p"), node("q"), node("r")]; // all z undefined → order p,q,r
		const map = computeZOrder(nodes, sel("p"), ZOrderOp.ToFront);
		expect(orderOf(nodes, map)).toEqual(["q", "r", "p"]);
	});
});
