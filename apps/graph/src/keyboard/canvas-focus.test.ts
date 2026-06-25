import { describe, expect, it } from "vitest";
import {
	type FocusableNode,
	SpatialDirection,
	focusableNodes,
	initialFocus,
	sequentialFocusStep,
	spatialFocusStep,
} from "./canvas-focus";

const posMap = (entries: Array<[string, number, number]>) =>
	new Map(entries.map(([id, x, y]) => [id, { x, y }]));

describe("focusableNodes", () => {
	it("keeps render order and pairs each node with its layout position", () => {
		const nodes = focusableNodes(
			[{ id: "a" }, { id: "b" }, { id: "c" }],
			posMap([
				["a", 10, 20],
				["b", 30, 40],
				["c", 50, 60],
			]),
		);
		expect(nodes).toEqual<FocusableNode[]>([
			{ id: "a", x: 10, y: 20 },
			{ id: "b", x: 30, y: 40 },
			{ id: "c", x: 50, y: 60 },
		]);
	});

	it("skips a node with no laid-out position (mid-reconcile)", () => {
		const nodes = focusableNodes([{ id: "a" }, { id: "b" }], posMap([["a", 1, 1]]));
		expect(nodes.map((n) => n.id)).toEqual(["a"]);
	});
});

describe("initialFocus", () => {
	it("is the first node in render order", () => {
		expect(
			initialFocus([
				{ id: "a", x: 0, y: 0 },
				{ id: "b", x: 1, y: 1 },
			]),
		).toBe("a");
	});
	it("is null for an empty graph", () => {
		expect(initialFocus([])).toBeNull();
	});
});

describe("sequentialFocusStep", () => {
	const ring: FocusableNode[] = [
		{ id: "a", x: 0, y: 0 },
		{ id: "b", x: 1, y: 0 },
		{ id: "c", x: 2, y: 0 },
	];

	it("advances and wraps forward", () => {
		expect(sequentialFocusStep(ring, "a", 1)).toBe("b");
		expect(sequentialFocusStep(ring, "c", 1)).toBe("a");
	});
	it("retreats and wraps backward", () => {
		expect(sequentialFocusStep(ring, "b", -1)).toBe("a");
		expect(sequentialFocusStep(ring, "a", -1)).toBe("c");
	});
	it("starts at the first node forward / last node backward when focus is unset", () => {
		expect(sequentialFocusStep(ring, null, 1)).toBe("a");
		expect(sequentialFocusStep(ring, null, -1)).toBe("c");
	});
	it("recovers when the focus node has left the ring", () => {
		expect(sequentialFocusStep(ring, "gone", 1)).toBe("a");
		expect(sequentialFocusStep(ring, "gone", -1)).toBe("c");
	});
	it("returns null for an empty graph", () => {
		expect(sequentialFocusStep([], "a", 1)).toBeNull();
	});
});

describe("spatialFocusStep", () => {
	// A plus-shaped layout: centre at origin, one neighbour each direction.
	const ring: FocusableNode[] = [
		{ id: "centre", x: 0, y: 0 },
		{ id: "right", x: 100, y: 0 },
		{ id: "left", x: -100, y: 0 },
		{ id: "down", x: 0, y: 100 },
		{ id: "up", x: 0, y: -100 },
	];

	it("moves to the nearest node in each direction", () => {
		expect(spatialFocusStep(ring, "centre", SpatialDirection.Right)).toBe("right");
		expect(spatialFocusStep(ring, "centre", SpatialDirection.Left)).toBe("left");
		expect(spatialFocusStep(ring, "centre", SpatialDirection.Down)).toBe("down");
		expect(spatialFocusStep(ring, "centre", SpatialDirection.Up)).toBe("up");
	});

	it("stays put at an edge (no node that way, no wrap)", () => {
		expect(spatialFocusStep(ring, "right", SpatialDirection.Right)).toBe("right");
	});

	it("starts at the first node when focus is unset", () => {
		expect(spatialFocusStep(ring, null, SpatialDirection.Right)).toBe("centre");
	});

	it("returns null for an empty graph", () => {
		expect(spatialFocusStep([], "centre", SpatialDirection.Up)).toBeNull();
	});

	it("prefers a well-aligned node over a nearer-but-skewed one", () => {
		const nodes: FocusableNode[] = [
			{ id: "from", x: 0, y: 0 },
			{ id: "aligned", x: 0, y: 120 }, // directly below
			{ id: "skewed", x: 90, y: 80 }, // closer by raw distance, off-axis
		];
		expect(spatialFocusStep(nodes, "from", SpatialDirection.Down)).toBe("aligned");
	});
});
