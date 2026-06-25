import { describe, expect, it } from "vitest";
import { type CullNode, type WorldRect, visibleNodeIds, worldViewport } from "./viewport-cull";

const node = (id: string, x: number, y: number): CullNode => ({ id, x, y, width: 100, height: 60 });

const viewport: WorldRect = { minX: 0, minY: 0, maxX: 500, maxY: 400 };

describe("visibleNodeIds", () => {
	it("keeps nodes inside the viewport, drops far off-screen ones", () => {
		const ids = visibleNodeIds([node("in", 100, 100), node("far", 5000, 5000)], viewport, 0);
		expect([...ids]).toEqual(["in"]);
	});

	it("keeps a node straddling an edge", () => {
		const ids = visibleNodeIds([node("edge", 480, 100)], viewport, 0);
		expect(ids.has("edge")).toBe(true);
	});

	it("padding keeps near-but-outside nodes mounted", () => {
		const justOutside = node("near", 600, 100); // 100px past maxX=500
		expect(visibleNodeIds([justOutside], viewport, 0).has("near")).toBe(false);
		expect(visibleNodeIds([justOutside], viewport, 250).has("near")).toBe(true);
	});

	it("is inclusive on a touching edge", () => {
		// left edge at x=500 == maxX → touches.
		expect(visibleNodeIds([node("touch", 500, 0)], viewport, 0).has("touch")).toBe(true);
	});
});

describe("worldViewport", () => {
	it("maps the screen viewport back to world via the inverse camera transform", () => {
		// world*1 + pan(50,20) = screen → world corners at (-50,-20)‥(750,580).
		const rect = worldViewport({ panX: 50, panY: 20, zoom: 1 }, { width: 800, height: 600 });
		expect(rect).toEqual({ minX: -50, minY: -20, maxX: 750, maxY: 580 });
	});

	it("accounts for zoom (a 2× zoom shows half the world)", () => {
		const rect = worldViewport({ panX: 0, panY: 0, zoom: 2 }, { width: 800, height: 600 });
		expect(rect).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
	});
});
