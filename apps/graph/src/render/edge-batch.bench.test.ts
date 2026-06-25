import { describe, expect, it } from "vitest";
import { type EdgeGeometryInput, buildEdgeBatches } from "./edge-batch";

/**
 * Frame-time / draw-call bench for the 9.13.15 edge-batching loop.
 *
 * We can't drive a real GPU under the `node` test environment, so the
 * bench measures the two things that actually drive Pixi edge frame time:
 *
 *   1. **Draw-call count** — the number of style transitions in the
 *      geometry instruction stream. Each transition forces the WebGL
 *      batcher to flush and start a new draw; on the first-cut renderer
 *      that was `N` strokes + `N` fills (`2N`), so GL draws grew linearly
 *      with edges. Batched, it collapses to `O(distinct styles)`. This is
 *      the dominant GPU-side cost and is exactly measurable here.
 *   2. **CPU geometry-build time** — the per-frame work to lay out the
 *      batch plan. Must stay well inside the 16 ms frame budget at scale.
 *
 * The bench prints before/after numbers to stdout (visible in the test
 * runner output) and asserts the batching invariant so a regression that
 * reintroduces per-edge draws fails CI.
 */

/** A realistic edge set: a handful of reason-category colours × a few
 *  alpha levels (matched / unmatched / focus-dimmed), spread in space so
 *  no two endpoints overlap (overlapping edges get dropped). Mirrors a
 *  dense real-vault graph. */
function syntheticEdges(count: number): EdgeGeometryInput[] {
	const tints = [0x8b9cff, 0xb9c0cc, 0xb9a3d6, 0x8b85ff];
	const alphas = [0.9, 0.6, 0.2, 0.18];
	const out: EdgeGeometryInput[] = [];
	for (let i = 0; i < count; i += 1) {
		const angle = (i / count) * Math.PI * 2;
		const r = 200 + (i % 400);
		out.push({
			sx: Math.cos(angle) * r,
			sy: Math.sin(angle) * r,
			dx: Math.cos(angle + 0.3) * (r + 120),
			dy: Math.sin(angle + 0.3) * (r + 120),
			sourceRadius: 4,
			destRadius: 5,
			tint: tints[i % tints.length] ?? 0x8b85ff,
			alpha: alphas[i % alphas.length] ?? 0.6,
		});
	}
	return out;
}

/** The first-cut renderer issued one stroke per edge + one fill per
 *  arrowhead — this is the GL draw count it produced (the "before"). */
function unbatchedDrawCalls(edges: readonly EdgeGeometryInput[], showArrows: boolean): number {
	return edges.length * (showArrows ? 2 : 1);
}

function median(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
		: (sorted[mid] ?? 0);
}

function timeBuild(edges: readonly EdgeGeometryInput[], showArrows: boolean): number {
	const samples: number[] = [];
	for (let run = 0; run < 30; run += 1) {
		const t0 = performance.now();
		buildEdgeBatches(edges, { zoom: 1, showArrows });
		samples.push(performance.now() - t0);
	}
	return median(samples);
}

describe("edge-batch frame-time bench (9.13.15)", () => {
	for (const count of [1_000, 5_000, 10_000]) {
		it(`draw calls collapse from ${count * 2} (per-edge) to a flat constant at ${count} edges`, () => {
			const edges = syntheticEdges(count);
			const plan = buildEdgeBatches(edges, { zoom: 1, showArrows: true });
			const before = unbatchedDrawCalls(edges, true);
			const buildMs = timeBuild(edges, true);

			// Batched draws = distinct (tint × alpha × {stroke,fill}) styles —
			// flat in edge count. With 4 tints × 4 alphas that's ≤ 16 strokes +
			// ≤ 16 fills.
			expect(plan.drawCalls).toBeLessThanOrEqual(32);
			expect(plan.drawCalls).toBeLessThan(before);

			// eslint-disable-next-line no-console
			console.log(
				`[bench ${count} edges] GL draw calls: ${before} (per-edge) → ${plan.drawCalls} (batched), ` +
					`${(before / plan.drawCalls).toFixed(0)}× fewer; ` +
					`CPU build ${buildMs.toFixed(3)} ms/frame (budget 16 ms)`,
			);

			// CPU geometry build stays well inside one frame even at 10k edges.
			expect(buildMs).toBeLessThan(16);
		});
	}

	it("the draw-call count is independent of edge count (the batching invariant)", () => {
		const a = buildEdgeBatches(syntheticEdges(1_000), { zoom: 1, showArrows: true });
		const b = buildEdgeBatches(syntheticEdges(10_000), { zoom: 1, showArrows: true });
		expect(a.drawCalls).toBe(b.drawCalls);
	});
});
