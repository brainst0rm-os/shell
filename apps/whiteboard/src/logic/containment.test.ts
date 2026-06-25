import { describe, expect, it } from "vitest";
import {
	type FrameNode,
	type GroupNode,
	ImageFit,
	type ImageNode,
	NodeKind,
	StickyColor,
	type StickyNode,
	type WhiteboardNode,
} from "../types/node";
import {
	type Bounds,
	containsBounds,
	frameMoveDelta,
	groupBounds,
	intersectsBounds,
	nodeBounds,
	nodesWithinFrame,
	resolveDragSet,
	translateNodes,
} from "./containment";

function sticky(id: string, x: number, y: number, width = 100, height = 80): StickyNode {
	return {
		id,
		kind: NodeKind.Sticky,
		x,
		y,
		width,
		height,
		text: id,
		color: StickyColor.Yellow,
	};
}

function image(id: string, x: number, y: number, w = 50, h = 50): ImageNode {
	return {
		id,
		kind: NodeKind.Image,
		x,
		y,
		width: w,
		height: h,
		imageUrl: "blob:x",
		fit: ImageFit.Contain,
	};
}

function frame(id: string, x: number, y: number, width: number, height: number): FrameNode {
	return {
		id,
		kind: NodeKind.Frame,
		x,
		y,
		width,
		height,
		title: id,
	};
}

function group(id: string, memberIds: string[]): GroupNode {
	return {
		id,
		kind: NodeKind.Group,
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		memberIds,
	};
}

describe("nodeBounds", () => {
	it("projects a node to its bounding box", () => {
		expect(nodeBounds(sticky("a", 5, 7, 30, 40))).toEqual({
			x: 5,
			y: 7,
			width: 30,
			height: 40,
		});
	});
});

describe("containsBounds", () => {
	const outer: Bounds = { x: 0, y: 0, width: 100, height: 100 };

	it("true for a strictly interior box", () => {
		expect(containsBounds(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
	});

	it("true when the inner box is flush against every edge (inclusive)", () => {
		expect(containsBounds(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
	});

	it("false when the inner box crosses an edge by one unit", () => {
		expect(containsBounds(outer, { x: 0, y: 0, width: 101, height: 100 })).toBe(false);
		expect(containsBounds(outer, { x: -1, y: 0, width: 100, height: 100 })).toBe(false);
	});

	it("true for a zero-size inner box sitting inside (a point)", () => {
		expect(containsBounds(outer, { x: 50, y: 50, width: 0, height: 0 })).toBe(true);
	});

	it("works with negative coordinates", () => {
		const o: Bounds = { x: -50, y: -50, width: 100, height: 100 };
		expect(containsBounds(o, { x: -40, y: -40, width: 10, height: 10 })).toBe(true);
		expect(containsBounds(o, { x: -60, y: -40, width: 10, height: 10 })).toBe(false);
	});
});

describe("intersectsBounds", () => {
	it("true for overlapping boxes", () => {
		expect(
			intersectsBounds({ x: 0, y: 0, width: 50, height: 50 }, { x: 25, y: 25, width: 50, height: 50 }),
		).toBe(true);
	});

	it("false for edge-only touching boxes", () => {
		expect(
			intersectsBounds({ x: 0, y: 0, width: 50, height: 50 }, { x: 50, y: 0, width: 50, height: 50 }),
		).toBe(false);
	});

	it("false for fully separated boxes", () => {
		expect(
			intersectsBounds(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 100, y: 100, width: 10, height: 10 },
			),
		).toBe(false);
	});

	it("symmetric in its arguments", () => {
		const a: Bounds = { x: 0, y: 0, width: 30, height: 30 };
		const b: Bounds = { x: 10, y: 10, width: 30, height: 30 };
		expect(intersectsBounds(a, b)).toBe(intersectsBounds(b, a));
	});

	it("a zero-size box on a boundary does not intersect", () => {
		expect(
			intersectsBounds({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 5, width: 0, height: 0 }),
		).toBe(false);
	});
});

describe("nodesWithinFrame", () => {
	const f = frame("F", 0, 0, 200, 200);

	it("includes leaf nodes fully inside the content region", () => {
		const inside = sticky("s1", 10, 10, 50, 50);
		const ids = nodesWithinFrame(f, [f, inside]).map((n) => n.id);
		expect(ids).toEqual(["s1"]);
	});

	it("excludes the frame itself", () => {
		const ids = nodesWithinFrame(f, [f]).map((n) => n.id);
		expect(ids).not.toContain("F");
	});

	it("excludes other Frame nodes even when geometrically inside", () => {
		const innerFrame = frame("F2", 10, 10, 50, 50);
		const ids = nodesWithinFrame(f, [f, innerFrame]).map((n) => n.id);
		expect(ids).not.toContain("F2");
	});

	it("excludes Group container nodes", () => {
		const g = group("G", ["s1"]);
		const ids = nodesWithinFrame(f, [f, g, sticky("s1", 10, 10)]).map((n) => n.id);
		expect(ids).toEqual(["s1"]);
	});

	it("excludes partially-overlapping nodes", () => {
		const straddler = sticky("s1", 190, 190, 50, 50);
		expect(nodesWithinFrame(f, [f, straddler])).toEqual([]);
	});

	it("excludes nodes entirely outside the frame", () => {
		const out = sticky("s1", 500, 500);
		expect(nodesWithinFrame(f, [f, out])).toEqual([]);
	});
});

describe("groupBounds", () => {
	it("returns the union AABB of resolved members", () => {
		const g = group("G", ["a", "b"]);
		const all: WhiteboardNode[] = [g, sticky("a", 0, 0, 50, 50), sticky("b", 100, 100, 50, 50)];
		expect(groupBounds(g, all)).toEqual({
			x: 0,
			y: 0,
			width: 150,
			height: 150,
		});
	});

	it("ignores dangling member ids but resolves the rest", () => {
		const g = group("G", ["a", "ghost"]);
		const all: WhiteboardNode[] = [g, sticky("a", 10, 10, 20, 20)];
		expect(groupBounds(g, all)).toEqual({
			x: 10,
			y: 10,
			width: 20,
			height: 20,
		});
	});

	it("returns null when no member resolves", () => {
		const g = group("G", ["ghost1", "ghost2"]);
		expect(groupBounds(g, [g])).toBeNull();
	});

	it("returns null for an empty group", () => {
		const g = group("G", []);
		expect(groupBounds(g, [g])).toBeNull();
	});

	it("handles negative member coordinates", () => {
		const g = group("G", ["a", "b"]);
		const all: WhiteboardNode[] = [g, sticky("a", -100, -100, 50, 50), sticky("b", 0, 0, 10, 10)];
		expect(groupBounds(g, all)).toEqual({
			x: -100,
			y: -100,
			width: 110,
			height: 110,
		});
	});
});

describe("translateNodes", () => {
	const all: WhiteboardNode[] = [sticky("a", 10, 20), sticky("b", 30, 40), sticky("c", 50, 60)];

	it("offsets exactly the named ids", () => {
		const moved = translateNodes(new Set(["a", "c"]), 5, -5, all);
		expect(moved.get("a")).toEqual({ x: 15, y: 15 });
		expect(moved.get("c")).toEqual({ x: 55, y: 55 });
		expect(moved.has("b")).toBe(false);
	});

	it("is identity at dx = dy = 0", () => {
		const moved = translateNodes(new Set(["a", "b"]), 0, 0, all);
		expect(moved.get("a")).toEqual({ x: 10, y: 20 });
		expect(moved.get("b")).toEqual({ x: 30, y: 40 });
	});

	it("does not mutate the input array or its nodes", () => {
		const snapshot = JSON.stringify(all);
		translateNodes(new Set(["a", "b", "c"]), 99, 99, all);
		expect(JSON.stringify(all)).toBe(snapshot);
	});

	it("skips ids absent from the scene", () => {
		const moved = translateNodes(new Set(["ghost"]), 1, 1, all);
		expect(moved.size).toBe(0);
	});
});

describe("resolveDragSet", () => {
	it("a lone node resolves to its singleton", () => {
		const n = sticky("a", 0, 0);
		expect([...resolveDragSet(n, [n])]).toEqual(["a"]);
	});

	it("a group member resolves to every member of its group", () => {
		const a = sticky("a", 0, 0);
		const b = sticky("b", 10, 10);
		const g = group("G", ["a", "b"]);
		const set = resolveDragSet(a, [g, a, b]);
		expect(new Set(set)).toEqual(new Set(["a", "b"]));
		expect(set.has("G")).toBe(false);
	});

	it("a frame resolves to the frame plus its spatially-contained nodes", () => {
		const f = frame("F", 0, 0, 200, 200);
		const inside = sticky("s1", 10, 10, 50, 50);
		const outside = sticky("s2", 500, 500);
		const set = resolveDragSet(f, [f, inside, outside]);
		expect(new Set(set)).toEqual(new Set(["F", "s1"]));
	});

	it("group membership wins even when the node is also a frame", () => {
		const f = frame("F", 0, 0, 200, 200);
		const g = group("G", ["F", "x"]);
		const set = resolveDragSet(f, [g, f, sticky("x", 0, 0)]);
		expect(new Set(set)).toEqual(new Set(["F", "x"]));
	});
});

describe("frameMoveDelta", () => {
	const f = frame("F", 0, 0, 200, 200);
	const inside1 = sticky("s1", 10, 10, 50, 50);
	const inside2 = image("i1", 80, 80, 40, 40);
	const outsider = sticky("s2", 500, 500);
	const all: WhiteboardNode[] = [f, inside1, inside2, outsider];

	it("returns the frame plus exactly the captured nodes with one shared delta", () => {
		const moved = frameMoveDelta(f, 25, -10, all);
		expect(new Set(moved.keys())).toEqual(new Set(["F", "s1", "i1"]));
		expect(moved.get("F")).toEqual({ x: 25, y: -10 });
		expect(moved.get("s1")).toEqual({ x: 35, y: 0 });
		expect(moved.get("i1")).toEqual({ x: 105, y: 70 });
	});

	it("leaves outsider nodes out of the result entirely", () => {
		const moved = frameMoveDelta(f, 25, -10, all);
		expect(moved.has("s2")).toBe(false);
	});

	it("does not mutate the input scene", () => {
		const snapshot = JSON.stringify(all);
		frameMoveDelta(f, 999, 999, all);
		expect(JSON.stringify(all)).toBe(snapshot);
	});

	it("every moved node shares the identical delta", () => {
		const moved = frameMoveDelta(f, 7, 13, all);
		for (const n of all) {
			const m = moved.get(n.id);
			if (!m) continue;
			expect(m.x - n.x).toBe(7);
			expect(m.y - n.y).toBe(13);
		}
	});
});

describe("property: every node in nodesWithinFrame is contained by the frame", () => {
	const f = frame("F", -120, -60, 400, 300);
	const frameBox = nodeBounds(f);

	it("holds across a generated grid of candidate nodes", () => {
		const scene: WhiteboardNode[] = [f];
		let idn = 0;
		for (let x = -200; x <= 320; x += 40) {
			for (let y = -120; y <= 300; y += 40) {
				for (const size of [10, 60, 140]) {
					scene.push(sticky(`g${idn++}`, x, y, size, size));
				}
			}
		}
		const within = nodesWithinFrame(f, scene);
		expect(within.length).toBeGreaterThan(0);
		for (const n of within) {
			expect(containsBounds(frameBox, nodeBounds(n))).toBe(true);
			expect(n.id).not.toBe("F");
		}
		const withinIds = new Set(within.map((n) => n.id));
		for (const n of scene) {
			if (n.id === "F") continue;
			const contained = containsBounds(frameBox, nodeBounds(n));
			expect(withinIds.has(n.id)).toBe(contained);
		}
	});
});
