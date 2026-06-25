import { describe, expect, it } from "vitest";
import {
	type CameraTransform,
	DEFAULT_CULL_MARGIN_PX,
	type ViewBounds,
	computeViewBounds,
	nodeInView,
	segmentInView,
	viewportUsable,
} from "./frustum-cull";

const IDENTITY: CameraTransform = { k: 1, tx: 0, ty: 0 };

describe("viewportUsable (fail-open guard — icons regression)", () => {
	it("accepts a real positive viewport", () => {
		expect(viewportUsable(1280, 800)).toBe(true);
		expect(viewportUsable(1, 1)).toBe(true);
	});

	it("rejects a zero / negative size (pre-layout or detached canvas)", () => {
		expect(viewportUsable(0, 800)).toBe(false);
		expect(viewportUsable(1280, 0)).toBe(false);
		expect(viewportUsable(0, 0)).toBe(false);
		expect(viewportUsable(-5, 800)).toBe(false);
	});

	it("rejects a non-finite size", () => {
		expect(viewportUsable(Number.NaN, 800)).toBe(false);
		expect(viewportUsable(1280, Number.POSITIVE_INFINITY)).toBe(false);
	});
});

describe("computeViewBounds", () => {
	it("inverts the identity transform to the viewport rect plus margin", () => {
		const b = computeViewBounds(IDENTITY, 800, 600, 0);
		expect(b).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
	});

	it("expands by the screen-space margin (in world units at k=1)", () => {
		const b = computeViewBounds(IDENTITY, 800, 600);
		expect(b.minX).toBe(-DEFAULT_CULL_MARGIN_PX);
		expect(b.maxX).toBe(800 + DEFAULT_CULL_MARGIN_PX);
		expect(b.minY).toBe(-DEFAULT_CULL_MARGIN_PX);
		expect(b.maxY).toBe(600 + DEFAULT_CULL_MARGIN_PX);
	});

	it("shrinks the world rect as the camera zooms in (k > 1)", () => {
		const b = computeViewBounds({ k: 2, tx: 0, ty: 0 }, 800, 600, 0);
		expect(b.maxX).toBe(400);
		expect(b.maxY).toBe(300);
	});

	it("accounts for pan translation", () => {
		const b = computeViewBounds({ k: 1, tx: -100, ty: -50 }, 800, 600, 0);
		expect(b.minX).toBe(100);
		expect(b.minY).toBe(50);
		expect(b.maxX).toBe(900);
		expect(b.maxY).toBe(650);
	});

	it("accounts for pan + zoom together (screen→world = (screen - t) / k)", () => {
		const b = computeViewBounds({ k: 2, tx: 100, ty: 50 }, 400, 200, 0);
		expect(b.minX).toBe((0 - 100) / 2);
		expect(b.maxX).toBe((400 - 100) / 2);
		expect(b.minY).toBe((0 - 50) / 2);
		expect(b.maxY).toBe((200 - 50) / 2);
	});

	it("stays finite when k collapses to zero (zoom-to-fit on empty scene)", () => {
		const b = computeViewBounds({ k: 0, tx: 0, ty: 0 }, 800, 600, 0);
		expect(Number.isFinite(b.minX)).toBe(true);
		expect(Number.isFinite(b.maxX)).toBe(true);
		expect(b.maxX).toBeGreaterThan(b.minX);
	});

	it("keeps min ≤ max and ignores a negative margin", () => {
		const b = computeViewBounds(IDENTITY, 800, 600, -999);
		expect(b).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
	});
});

describe("nodeInView", () => {
	const b: ViewBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

	it("keeps a node inside the rect", () => {
		expect(nodeInView(50, 50, 4, b)).toBe(true);
	});

	it("culls a node fully outside the rect", () => {
		expect(nodeInView(500, 50, 4, b)).toBe(false);
		expect(nodeInView(50, -500, 4, b)).toBe(false);
	});

	it("keeps a node whose radius grazes the edge", () => {
		expect(nodeInView(103, 50, 5, b)).toBe(true);
		expect(nodeInView(103, 50, 2, b)).toBe(false);
	});

	it("keeps a node exactly on the boundary", () => {
		expect(nodeInView(0, 0, 0, b)).toBe(true);
		expect(nodeInView(100, 100, 0, b)).toBe(true);
	});
});

describe("segmentInView", () => {
	const b: ViewBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

	it("keeps an edge fully inside", () => {
		expect(segmentInView(10, 10, 90, 90, b)).toBe(true);
	});

	it("keeps an edge that crosses the rect from outside", () => {
		expect(segmentInView(-50, 50, 200, 50, b)).toBe(true);
	});

	it("culls an edge whose bounding box misses entirely", () => {
		expect(segmentInView(200, 200, 300, 400, b)).toBe(false);
		expect(segmentInView(-100, -100, -50, -50, b)).toBe(false);
	});

	it("keeps a corner-grazing edge (bbox superset is intentional)", () => {
		expect(segmentInView(150, 90, 90, 150, b)).toBe(true);
		expect(segmentInView(-10, 110, 110, -10, b)).toBe(true);
	});
});

describe("frustum cull frame budget — 5k-node bench", () => {
	it("culls a 5000-node + 7500-edge frame in well under the 16.6ms budget", () => {
		const NODES = 5000;
		const EDGES = 7500;
		let seed = 1337;
		const rnd = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 0xffffffff;
		};
		const xs = new Float64Array(NODES);
		const ys = new Float64Array(NODES);
		for (let i = 0; i < NODES; i += 1) {
			xs[i] = rnd() * 12000 - 6000;
			ys[i] = rnd() * 12000 - 6000;
		}
		const edges: Array<[number, number]> = [];
		for (let i = 0; i < EDGES; i += 1) {
			edges.push([Math.floor(rnd() * NODES), Math.floor(rnd() * NODES)]);
		}
		const bounds = computeViewBounds({ k: 2.5, tx: 200, ty: 150 }, 1280, 800);

		const FRAMES = 60;
		const start = performance.now();
		let visible = 0;
		let drawnEdges = 0;
		for (let f = 0; f < FRAMES; f += 1) {
			for (let i = 0; i < NODES; i += 1) {
				if (nodeInView(xs[i] as number, ys[i] as number, 8, bounds)) visible += 1;
			}
			for (const [s, d] of edges) {
				if (segmentInView(xs[s] as number, ys[s] as number, xs[d] as number, ys[d] as number, bounds)) {
					drawnEdges += 1;
				}
			}
		}
		const perFrameMs = (performance.now() - start) / FRAMES;

		expect(perFrameMs).toBeLessThan(8);
		expect(visible / FRAMES).toBeGreaterThan(0);
		expect(visible / FRAMES).toBeLessThan(NODES);
		expect(drawnEdges / FRAMES).toBeLessThan(EDGES);
	});
});
