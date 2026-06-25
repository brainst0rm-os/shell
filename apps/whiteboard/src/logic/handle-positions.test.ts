import { describe, expect, it } from "vitest";
import { HandleSide } from "../types/edge";
import { NodeKind, StickyColor, type WhiteboardNode } from "../types/node";
import { normalForSide, positionForHandle } from "./handle-positions";

function node(
	overrides: Partial<Pick<WhiteboardNode, "x" | "y" | "width" | "height">> = {},
): WhiteboardNode {
	return {
		id: "n",
		kind: NodeKind.Sticky,
		x: 100,
		y: 50,
		width: 200,
		height: 100,
		text: "",
		color: StickyColor.Yellow,
		...overrides,
	};
}

describe("positionForHandle", () => {
	const n = node(); // x=100..300, y=50..150, center=(200,100)

	it("Top → midpoint of the top edge", () => {
		expect(positionForHandle(n, HandleSide.Top)).toEqual({ x: 200, y: 50 });
	});

	it("Right → midpoint of the right edge", () => {
		expect(positionForHandle(n, HandleSide.Right)).toEqual({ x: 300, y: 100 });
	});

	it("Bottom → midpoint of the bottom edge", () => {
		expect(positionForHandle(n, HandleSide.Bottom)).toEqual({ x: 200, y: 150 });
	});

	it("Left → midpoint of the left edge", () => {
		expect(positionForHandle(n, HandleSide.Left)).toEqual({ x: 100, y: 100 });
	});

	it("scales with node size — square 50×50 at origin", () => {
		const square = node({ x: 0, y: 0, width: 50, height: 50 });
		expect(positionForHandle(square, HandleSide.Top)).toEqual({ x: 25, y: 0 });
		expect(positionForHandle(square, HandleSide.Bottom)).toEqual({ x: 25, y: 50 });
	});

	it("handles non-integer bbox without rounding loss", () => {
		const odd = node({ x: 10, y: 10, width: 15, height: 25 });
		expect(positionForHandle(odd, HandleSide.Right)).toEqual({ x: 25, y: 22.5 });
	});
});

describe("normalForSide", () => {
	it("unit vectors point outward from each side", () => {
		expect(normalForSide(HandleSide.Top)).toEqual({ x: 0, y: -1 });
		expect(normalForSide(HandleSide.Right)).toEqual({ x: 1, y: 0 });
		expect(normalForSide(HandleSide.Bottom)).toEqual({ x: 0, y: 1 });
		expect(normalForSide(HandleSide.Left)).toEqual({ x: -1, y: 0 });
	});
});
