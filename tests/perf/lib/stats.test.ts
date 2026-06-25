/**
 * 12.7 step 1 — edge-case units for `summarize`.
 *
 * The aggregator (`check-results.ts`) decides pass/fail per spec by reading
 * `stats.median` from each result; the IPC spec also leans on `p99`. A silent
 * off-by-one in `percentile` could slip a regression by one rank with no
 * observable change in the report, so this file pins:
 *
 *   - the percentile method (linear interpolation between rank-floor and
 *     rank-ceil — `rank = q * (n - 1)`),
 *   - the empty/single/all-equal edge cases (`summarize([])` returns deterministic
 *     zeros; `summarize([x])` returns x for every percentile),
 *   - the monotone reference series `[1,2,3,4,5]` (the algebraic check on
 *     median/p95/p99 derived from `rank = q * 4`).
 *
 * `percentile` is module-private, so it's exercised through `summarize`
 * indirectly; that's intentional — the public surface is what the aggregator
 * actually consumes.
 */

import { describe, expect, it } from "vitest";
import { summarize } from "./stats";

describe("summarize", () => {
	it("returns deterministic zeros on an empty sample", () => {
		expect(summarize([])).toEqual({
			samples: 0,
			min: 0,
			median: 0,
			p95: 0,
			p99: 0,
			max: 0,
			mean: 0,
		});
	});

	it("collapses a one-element sample to that element across all percentiles", () => {
		expect(summarize([5])).toEqual({
			samples: 1,
			min: 5,
			median: 5,
			p95: 5,
			p99: 5,
			max: 5,
			mean: 5,
		});
	});

	it("returns the constant across every percentile on an all-equal sample", () => {
		const stats = summarize([1, 1, 1, 1, 1]);
		expect(stats.samples).toBe(5);
		expect(stats.min).toBe(1);
		expect(stats.median).toBe(1);
		expect(stats.p95).toBe(1);
		expect(stats.p99).toBe(1);
		expect(stats.max).toBe(1);
		expect(stats.mean).toBe(1);
	});

	it("matches the linear-interpolation formula on the monotone series 1..5", () => {
		// rank = q * (n - 1) = q * 4 for n=5.
		//   q=0.5  → rank=2.0  → exact element 3
		//   q=0.95 → rank=3.8  → 4 + (5-4)*0.8  = 4.8
		//   q=0.99 → rank=3.96 → 4 + (5-4)*0.96 = 4.96
		const stats = summarize([1, 2, 3, 4, 5]);
		expect(stats.samples).toBe(5);
		expect(stats.min).toBe(1);
		expect(stats.max).toBe(5);
		expect(stats.median).toBe(3);
		expect(stats.p95).toBeCloseTo(4.8, 10);
		expect(stats.p99).toBeCloseTo(4.96, 10);
		expect(stats.mean).toBe(3);
	});

	it("sorts before percentile-ing so input order doesn't change the answer", () => {
		const ascending = summarize([1, 2, 3, 4, 5]);
		const shuffled = summarize([3, 1, 5, 2, 4]);
		expect(shuffled).toEqual(ascending);
	});

	it("handles a two-element sample so the median sits midway", () => {
		// rank = 0.5 * 1 = 0.5 → 1 + (2-1)*0.5 = 1.5.
		const stats = summarize([1, 2]);
		expect(stats.median).toBe(1.5);
		expect(stats.min).toBe(1);
		expect(stats.max).toBe(2);
		expect(stats.mean).toBe(1.5);
	});
});
