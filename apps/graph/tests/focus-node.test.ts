import { describe, expect, it } from "vitest";
import { focusNodeTransform } from "../src/render/focus-node";

const VIEW = { width: 1000, height: 600 };
const ZOOM = { min: 0.05, max: 10 };

describe("focusNodeTransform", () => {
	it("centres the node in the viewBox at the requested zoom", () => {
		const t = focusNodeTransform({ x: 200, y: 100 }, VIEW, 2, ZOOM);
		expect(t).toEqual({ k: 2, tx: 1000 / 2 - 200 * 2, ty: 600 / 2 - 100 * 2 });
		// The node lands exactly at the viewBox centre: screen = world*k + t.
		expect(200 * t.k + t.tx).toBe(VIEW.width / 2);
		expect(100 * t.k + t.ty).toBe(VIEW.height / 2);
	});

	it("clamps zoom into the supplied bounds", () => {
		expect(focusNodeTransform({ x: 0, y: 0 }, VIEW, 999, ZOOM).k).toBe(10);
		expect(focusNodeTransform({ x: 0, y: 0 }, VIEW, 0.0001, ZOOM).k).toBe(0.05);
	});

	it("a node at the origin centres on the viewBox midpoint", () => {
		expect(focusNodeTransform({ x: 0, y: 0 }, VIEW, 1, ZOOM)).toEqual({
			k: 1,
			tx: 500,
			ty: 300,
		});
	});
});
