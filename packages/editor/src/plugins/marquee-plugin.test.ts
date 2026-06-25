import { describe, expect, it } from "vitest";
import { rectsIntersect } from "./marquee-plugin";

describe("rectsIntersect", () => {
	it("returns true for overlapping rects", () => {
		expect(
			rectsIntersect(
				{ left: 0, top: 0, right: 10, bottom: 10 },
				{ left: 5, top: 5, right: 15, bottom: 15 },
			),
		).toBe(true);
	});

	it("returns true for one rect entirely inside another", () => {
		expect(
			rectsIntersect(
				{ left: 0, top: 0, right: 100, bottom: 100 },
				{ left: 20, top: 20, right: 30, bottom: 30 },
			),
		).toBe(true);
	});

	it("returns true for rects sharing an edge", () => {
		expect(
			rectsIntersect(
				{ left: 0, top: 0, right: 10, bottom: 10 },
				{ left: 10, top: 0, right: 20, bottom: 10 },
			),
		).toBe(true);
	});

	it("returns false for rects fully apart horizontally", () => {
		expect(
			rectsIntersect(
				{ left: 0, top: 0, right: 10, bottom: 10 },
				{ left: 20, top: 0, right: 30, bottom: 10 },
			),
		).toBe(false);
	});

	it("returns false for rects fully apart vertically", () => {
		expect(
			rectsIntersect(
				{ left: 0, top: 0, right: 10, bottom: 10 },
				{ left: 0, top: 20, right: 10, bottom: 30 },
			),
		).toBe(false);
	});

	it("works for negative coordinates (off-screen drag start)", () => {
		expect(
			rectsIntersect(
				{ left: -10, top: -10, right: 5, bottom: 5 },
				{ left: 0, top: 0, right: 10, bottom: 10 },
			),
		).toBe(true);
	});
});
