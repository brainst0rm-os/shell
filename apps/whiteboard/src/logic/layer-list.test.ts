import { describe, expect, it } from "vitest";
import { NodeKind, type ShapeKind, StickyColor, type WhiteboardNode } from "../types/node";
import { buildLayerList } from "./layer-list";

function sticky(
	id: string,
	zIndex: number | undefined,
	text = "",
	extra: Partial<WhiteboardNode> = {},
): WhiteboardNode {
	return {
		id,
		kind: NodeKind.Sticky,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		text,
		color: StickyColor.Yellow,
		...(zIndex !== undefined ? { zIndex } : {}),
		...extra,
	} as WhiteboardNode;
}

describe("buildLayerList", () => {
	it("orders top-of-stack first (z desc, doc-order tiebreak)", () => {
		const rows = buildLayerList([sticky("a", 0), sticky("b", 2), sticky("c", 1)]);
		expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
	});

	it("absent z sorts as 0, ties broken by document order", () => {
		const rows = buildLayerList([sticky("p", undefined), sticky("q", undefined)]);
		expect(rows.map((r) => r.id)).toEqual(["p", "q"]);
	});

	it("carries the content snippet + locked/hidden flags", () => {
		const rows = buildLayerList([
			sticky("a", 1, "  Hello  ", { locked: true }),
			sticky("b", 0, "", { hidden: true }),
		]);
		expect(rows[0]).toMatchObject({ id: "a", snippet: "Hello", locked: true, hidden: false });
		expect(rows[1]).toMatchObject({ id: "b", snippet: "", locked: false, hidden: true });
	});

	it("frame snippet comes from the title", () => {
		const frame = {
			id: "f",
			kind: NodeKind.Frame,
			x: 0,
			y: 0,
			width: 200,
			height: 200,
			title: "Sprint board",
		} as WhiteboardNode;
		expect(buildLayerList([frame])[0]?.snippet).toBe("Sprint board");
	});

	it("kinds without inherent text have an empty snippet", () => {
		const shape = {
			id: "s",
			kind: NodeKind.Shape,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			shape: "rectangle" as ShapeKind,
			color: StickyColor.Blue,
		} as WhiteboardNode;
		expect(buildLayerList([shape])[0]?.snippet).toBe("");
	});
});
