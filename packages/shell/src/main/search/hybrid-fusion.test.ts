import { describe, expect, it } from "vitest";
import { RRF_K, reciprocalRankFusion } from "./hybrid-fusion";

const ids = (refs: { id: string }[]) => refs.map((r) => r.id);

describe("reciprocalRankFusion", () => {
	it("preserves rank order for a single list", () => {
		const out = reciprocalRankFusion([[{ id: "a" }, { id: "b" }, { id: "c" }]]);
		expect(ids(out)).toEqual(["a", "b", "c"]);
		// Score decreases with rank: 1/(k+1) > 1/(k+2) > 1/(k+3).
		expect(out[0]?.score).toBeCloseTo(1 / (RRF_K + 1));
		expect(out[2]?.score).toBeCloseTo(1 / (RRF_K + 3));
	});

	it("boosts an id that ranks in both lists above either alone", () => {
		// Lexical: a, b. Vector: b, c. `b` is rank-2 lexical + rank-1 vector.
		const out = reciprocalRankFusion([
			[{ id: "a" }, { id: "b" }],
			[{ id: "b" }, { id: "c" }],
		]);
		expect(out[0]?.id).toBe("b");
		const score = new Map(out.map((r) => [r.id, r.score]));
		expect(score.get("b")).toBeGreaterThan(score.get("a") ?? 0);
		expect(score.get("b")).toBeGreaterThan(score.get("c") ?? 0);
		expect(ids(out).sort()).toEqual(["a", "b", "c"]);
	});

	it("breaks score ties by first-seen (lexical-first) order via the stable sort", () => {
		// Each id is rank-1 in its own single-item list → identical scores.
		const out = reciprocalRankFusion([[{ id: "x" }], [{ id: "y" }]]);
		expect(ids(out)).toEqual(["x", "y"]);
		expect(out[0]?.score).toBeCloseTo(out[1]?.score ?? -1);
	});

	it("returns an empty array for no lists / empty lists", () => {
		expect(reciprocalRankFusion([])).toEqual([]);
		expect(reciprocalRankFusion([[], []])).toEqual([]);
	});

	it("honours a custom k (smaller k sharpens the top-rank advantage)", () => {
		const sharp = reciprocalRankFusion([[{ id: "a" }, { id: "b" }]], 1);
		expect(sharp[0]?.score).toBeCloseTo(1 / 2);
		expect(sharp[1]?.score).toBeCloseTo(1 / 3);
	});
});
