import { describe, expect, it } from "vitest";
import { type LabelBox, declutterLabels, estimateLabelWidth } from "./label-declutter";

function box(id: string, centerX: number, top: number, priority: number, width = 40): LabelBox {
	return { id, centerX, top, width, height: 12, priority };
}

describe("declutterLabels (F-230 overlap suppression)", () => {
	it("keeps all labels when none overlap", () => {
		const kept = declutterLabels([box("a", 0, 0, 1), box("b", 200, 0, 1), box("c", 0, 200, 1)]);
		expect(kept).toEqual(new Set(["a", "b", "c"]));
	});

	it("drops the lower-priority label when two overlap", () => {
		// Same centre → boxes overlap; b has the higher priority and wins.
		const kept = declutterLabels([box("a", 100, 100, 1), box("b", 100, 100, 5)]);
		expect(kept).toEqual(new Set(["b"]));
	});

	it("resolves a dense cluster down to the non-overlapping survivors", () => {
		// Four hub labels stacked on the same spot (the reported smear) collapse
		// to the single highest-priority one.
		const kept = declutterLabels([
			box("operating-hub", 300, 300, 4),
			box("content-calendar", 305, 302, 3),
			box("candidates", 302, 301, 2),
			box("priya", 304, 303, 1),
		]);
		expect(kept).toEqual(new Set(["operating-hub"]));
	});

	it("breaks priority ties by input order (stable)", () => {
		const kept = declutterLabels([box("first", 50, 50, 2), box("second", 52, 51, 2)]);
		expect(kept).toEqual(new Set(["first"]));
	});

	it("returns an empty set for no candidates", () => {
		expect(declutterLabels([])).toEqual(new Set());
	});
});

describe("estimateLabelWidth", () => {
	it("scales with character count", () => {
		expect(estimateLabelWidth("")).toBe(0);
		expect(estimateLabelWidth("abc")).toBeGreaterThan(0);
		expect(estimateLabelWidth("abcdef")).toBeGreaterThan(estimateLabelWidth("abc"));
	});
});
