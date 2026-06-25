import { describe, expect, it } from "vitest";
import { type EdgeGeometryInput, buildEdgeBatches, quantiseAlpha } from "./edge-batch";

/** A horizontal edge from (0,0) to (100,0), unit radii, default style. */
function edge(over: Partial<EdgeGeometryInput> = {}): EdgeGeometryInput {
	return {
		sx: 0,
		sy: 0,
		dx: 100,
		dy: 0,
		sourceRadius: 4,
		destRadius: 4,
		tint: 0x8b85ff,
		alpha: 0.6,
		...over,
	};
}

const NO_ARROWS = { zoom: 1, showArrows: false } as const;
const ARROWS = { zoom: 1, showArrows: true } as const;

describe("buildEdgeBatches — batching by render style", () => {
	it("collapses many same-style edges into ONE stroke batch (the whole point)", () => {
		const edges = Array.from({ length: 500 }, (_, i) => edge({ sy: i, dy: i }));
		const plan = buildEdgeBatches(edges, NO_ARROWS);
		expect(plan.edgeCount).toBe(500);
		// 500 edges, one tint + one alpha → a single stroke batch, one GL draw.
		expect(plan.strokes).toHaveLength(1);
		expect(plan.fills).toHaveLength(0);
		expect(plan.drawCalls).toBe(1);
		// Every segment is in that one buffer: 4 coords each.
		expect(plan.strokes[0]?.segments).toHaveLength(500 * 4);
	});

	it("splits batches by distinct tint", () => {
		const plan = buildEdgeBatches(
			[edge({ tint: 0x111111 }), edge({ tint: 0x222222 }), edge({ tint: 0x111111 })],
			NO_ARROWS,
		);
		expect(plan.strokes).toHaveLength(2);
		const byTint = new Map(plan.strokes.map((b) => [b.tint, b.segments.length]));
		// Two edges share 0x111111 → 8 coords; one edge 0x222222 → 4.
		expect(byTint.get(0x111111)).toBe(8);
		expect(byTint.get(0x222222)).toBe(4);
	});

	it("splits batches by quantised alpha but COALESCES near-identical alpha", () => {
		// 0.600 and 0.601 quantise to the same step → one batch; 0.2 is distinct.
		const plan = buildEdgeBatches(
			[edge({ alpha: 0.6 }), edge({ alpha: 0.601 }), edge({ alpha: 0.2 })],
			NO_ARROWS,
		);
		expect(plan.strokes).toHaveLength(2);
		const coalesced = plan.strokes.find((b) => b.segments.length === 8);
		expect(coalesced).toBeDefined();
	});

	it("draw-call count stays FLAT as edge count grows (batching invariant)", () => {
		const small = buildEdgeBatches(
			Array.from({ length: 10 }, (_, i) => edge({ sy: i, dy: i })),
			NO_ARROWS,
		);
		const large = buildEdgeBatches(
			Array.from({ length: 10_000 }, (_, i) => edge({ sy: i, dy: i })),
			NO_ARROWS,
		);
		expect(small.drawCalls).toBe(large.drawCalls);
		expect(large.edgeCount).toBe(10_000);
	});
});

describe("buildEdgeBatches — arrowheads", () => {
	it("adds a fill batch per style when arrows show", () => {
		const plan = buildEdgeBatches([edge(), edge({ sy: 1, dy: 1 })], ARROWS);
		expect(plan.strokes).toHaveLength(1);
		expect(plan.fills).toHaveLength(1);
		// One triangle per edge: 6 coords each.
		expect(plan.fills[0]?.triangles).toHaveLength(2 * 6);
		expect(plan.drawCalls).toBe(2); // 1 stroke + 1 fill
	});

	it("emits no fills when the user toggles arrows off", () => {
		const plan = buildEdgeBatches([edge()], NO_ARROWS);
		expect(plan.fills).toHaveLength(0);
	});

	it("emits no fills below the arrowhead LOD zoom even with the toggle on", () => {
		const plan = buildEdgeBatches([edge()], { zoom: 0.4, showArrows: true });
		expect(plan.fills).toHaveLength(0);
	});
});

describe("buildEdgeBatches — geometry", () => {
	it("trims the segment off both node discs", () => {
		const plan = buildEdgeBatches([edge({ sourceRadius: 4, destRadius: 4 })], NO_ARROWS);
		const seg = plan.strokes[0]?.segments ?? [];
		// Source trim = radius(4) + DISC_TRIM(3) = 7 → x1 = 7.
		expect(seg[0]).toBeCloseTo(7, 5);
		expect(seg[1]).toBeCloseTo(0, 5);
		// Dest trim = 7 (no arrow) → x2 = 100 - 7 = 93.
		expect(seg[2]).toBeCloseTo(93, 5);
		expect(seg[3]).toBeCloseTo(0, 5);
	});

	it("adds extra destination trim when an arrowhead shows", () => {
		const plan = buildEdgeBatches([edge()], ARROWS);
		const seg = plan.strokes[0]?.segments ?? [];
		// Dest trim = radius(4) + DISC_TRIM(3) + ARROW_TRIM(5) = 12 → x2 = 88.
		expect(seg[2]).toBeCloseTo(88, 5);
	});

	it("drops a degenerate edge whose trims cross (overlapping nodes)", () => {
		// 10px apart but 7px trimmed off each end → the segment reverses.
		const plan = buildEdgeBatches([edge({ dx: 10 })], NO_ARROWS);
		expect(plan.edgeCount).toBe(0);
		expect(plan.strokes).toHaveLength(0);
	});

	it("places the arrowhead tip at the trimmed destination end", () => {
		const plan = buildEdgeBatches([edge()], ARROWS);
		const tri = plan.fills[0]?.triangles ?? [];
		// First vertex is the tip = trimmed dest (x2 = 88, y = 0).
		expect(tri[0]).toBeCloseTo(88, 5);
		expect(tri[1]).toBeCloseTo(0, 5);
	});
});

describe("quantiseAlpha", () => {
	it("clamps out-of-range input into [0,1]", () => {
		expect(quantiseAlpha(-1)).toBe(0);
		expect(quantiseAlpha(2)).toBe(1);
	});

	it("snaps to a bounded set of steps (idempotent on a snapped value)", () => {
		const q = quantiseAlpha(0.37);
		expect(quantiseAlpha(q)).toBe(q);
		// Distinct inputs that fall in the same step collapse to one value.
		expect(quantiseAlpha(0.6)).toBe(quantiseAlpha(0.601));
	});
});
