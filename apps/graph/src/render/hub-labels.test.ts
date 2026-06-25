import { describe, expect, it } from "vitest";
import { topNByRadius } from "./pixi-renderer";
import type { RenderNode } from "./svg-renderer";

function node(id: string, radius: number, alpha = 1): RenderNode {
	return {
		id,
		entity: { id, type: "Note", title: id, createdAt: 0 } as never,
		subjectName: null,
		color: "#000",
		radius,
		alpha,
		icon: null,
		iconSrc: "",
		glyph: "",
	};
}

describe("topNByRadius (F-048 hub labels at rest)", () => {
	it("returns the n largest-radius nodes, largest first", () => {
		const nodes = [node("a", 6), node("b", 20), node("c", 12), node("d", 9)];
		expect(topNByRadius(nodes, 2).map((n) => n.id)).toEqual(["b", "c"]);
	});

	it("skips faded-out nodes (alpha ≤ 0.05)", () => {
		const nodes = [node("a", 30, 0), node("b", 10, 1), node("c", 8, 1)];
		expect(topNByRadius(nodes, 2).map((n) => n.id)).toEqual(["b", "c"]);
	});

	it("returns fewer than n when the graph is small, and [] for n ≤ 0", () => {
		expect(topNByRadius([node("a", 6)], 8).map((n) => n.id)).toEqual(["a"]);
		expect(topNByRadius([node("a", 6)], 0)).toEqual([]);
		expect(topNByRadius([], 8)).toEqual([]);
	});
});
