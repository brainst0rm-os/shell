/**
 * ForceEngine — the stateful simulation core, extracted so it can run
 * **off the renderer main thread** (9.13.5: pixi + d3-force-in-worker).
 *
 * It owns its own node array + `alpha` and steps the pure functions in
 * `force-layout.ts`. It has zero DOM / Worker / timer dependencies, so:
 *   - `force-worker.ts` wraps one instance behind `postMessage` + a
 *     `setInterval` pump (used when a Worker can actually run — i.e. a
 *     real origin, not the `file://` the shell currently serves apps
 *     from; see `layout-driver.ts`).
 *   - `layout-driver.ts` holds one directly and drives it with a
 *     per-frame time budget (`stepFor`) — the path used under `file://`
 *     and in tests. It never blocks the thread regardless of budget.
 *
 * The synchronous `preConverge` it used to run on `reset` is gone: that
 * ≤300×O(n²) pass froze the renderer for seconds on every object-open.
 * Convergence is now spread across frames by `stepFor`.
 *
 * Positions cross the worker boundary as a flat `Float32Array`
 * (`[x0,y0,x1,y1,…]`) in a fixed `ids` order per `epoch`; a topology
 * change bumps the epoch so in-flight frames from the old order are
 * dropped by the consumer.
 */

import {
	ALPHA_MIN,
	type LayoutEdge,
	type LayoutNode,
	type LayoutParams,
	markOrphans,
	seededRng,
	tickLayout,
} from "./force-layout";

/** Wall-clock used to time-slice `stepFor`. `performance.now()` exists in
 *  workers + the renderer; falls back to `Date.now()` in bare contexts. */
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** One topology push. `xs/ys/rs` are parallel to `ids`; `edges` is a
 *  flat `[s0,t0,s1,t1,…]` of indices into `ids`; `fixed` carries the
 *  drag/pin overrides as `(index, fx, fy)` triples. */
export type EngineGraph = {
	ids: readonly string[];
	xs: Float32Array;
	ys: Float32Array;
	rs: Float32Array;
	edges: Int32Array;
	fixed: ReadonlyArray<{ i: number; fx: number; fy: number }>;
	/** How much to warm the simulation on this push (0..1). 1 is a full
	 *  re-seed for a wholesale topology change (vault load, preset
	 *  switch); ~0.3 is the incremental-playback case where a couple of
	 *  new nodes appear each frame and a full re-energise would visibly
	 *  oscillate hubs that were already at rest. 0 leaves the sim cool
	 *  (radius-only refresh). */
	reheat: number;
};

/** Hard cap on ticks per warm period. Without it a 600+-node O(n²) sim
 *  alpha-decays for ~90+ ticks every reheat, and time-slicing that at a
 *  few ticks/frame is ~1s+ of degraded fps. The layout is visually
 *  "settled enough" well before full alpha decay, so we force-cool after
 *  this many ticks — bounding the dropped-frame window regardless of N. */
const MAX_TICKS_PER_WARM = 90;

export class ForceEngine {
	private params: LayoutParams;
	private nodes: LayoutNode[] = [];
	private edges: LayoutEdge[] = [];
	private index = new Map<string, LayoutNode>();
	private alphaValue = 0;
	private ticksSinceReheat = 0;

	constructor(params: LayoutParams) {
		this.params = params;
	}

	get alpha(): number {
		return this.alphaValue;
	}

	/** Warm = still worth stepping. Cooled (alpha floor) OR tick-capped
	 *  sims report `false` so the pump stops (CPU → 0, fps recovers)
	 *  until something reheats. */
	get warm(): boolean {
		return this.alphaValue > ALPHA_MIN && this.ticksSinceReheat < MAX_TICKS_PER_WARM;
	}

	private warmUp(alpha: number): void {
		this.alphaValue = Math.max(this.alphaValue, alpha);
		this.ticksSinceReheat = 0;
	}

	/** One tick + bookkeeping. The single path both `step` and `stepFor`
	 *  go through so the tick cap is honoured uniformly. */
	private advance(): void {
		this.alphaValue = tickLayout(this.nodes, this.edges, this.params, this.alphaValue);
		this.ticksSinceReheat += 1;
	}

	get nodeCount(): number {
		return this.nodes.length;
	}

	setParams(params: LayoutParams): void {
		this.params = params;
		// A parameter change (slider) only matters while converging; nudge
		// alpha so a cooled graph re-settles to the new equilibrium.
		this.warmUp(0.3);
	}

	reheat(alpha: number): void {
		this.warmUp(alpha);
	}

	/** Replace the topology. Existing ids keep their simulated position
	 *  (so an unrelated edit doesn't teleport the graph); new ids take
	 *  the caller-seeded `xs/ys`. On `reheat` the sim is warmed (alpha=1)
	 *  but NOT converged here — convergence is time-sliced by `stepFor`
	 *  so the thread never blocks. */
	reset(graph: EngineGraph): void {
		const next: LayoutNode[] = [];
		const nextIndex = new Map<string, LayoutNode>();
		const jitter = seededRng(graph.ids.length + 17);
		for (let i = 0; i < graph.ids.length; i += 1) {
			const id = graph.ids[i] as string;
			const prev = this.index.get(id);
			const node: LayoutNode = prev ?? {
				id,
				x: graph.xs[i] ?? 0,
				y: graph.ys[i] ?? 0,
				vx: 0,
				vy: 0,
				pinned: false,
				fx: null,
				fy: null,
				radius: graph.rs[i] ?? 6,
				isOrphan: true,
			};
			node.radius = graph.rs[i] ?? node.radius;
			// New nodes start exactly where the caller seeded them (+ a hair
			// of jitter so identical seeds don't stack on one pixel).
			if (!prev) {
				node.x = (graph.xs[i] ?? 0) + (jitter() * 2 - 1);
				node.y = (graph.ys[i] ?? 0) + (jitter() * 2 - 1);
			}
			node.fx = null;
			node.fy = null;
			next.push(node);
			nextIndex.set(id, node);
		}
		for (const f of graph.fixed) {
			const node = next[f.i];
			if (node) {
				node.fx = f.fx;
				node.fy = f.fy;
			}
		}
		const edges: LayoutEdge[] = [];
		for (let e = 0; e + 1 < graph.edges.length; e += 2) {
			const s = graph.ids[graph.edges[e] as number];
			const t = graph.ids[graph.edges[e + 1] as number];
			if (s !== undefined && t !== undefined) edges.push({ source: s, target: t });
		}
		this.nodes = next;
		this.edges = edges;
		this.index = nextIndex;
		markOrphans(this.nodes, this.edges);
		if (graph.reheat > 0) {
			// Warm the sim but DO NOT pre-converge synchronously here. A
			// synchronous `preConverge` (≤300 × O(n²)) blocked the renderer
			// main thread for seconds on every object-open. Convergence is
			// time-sliced across frames by `stepFor` AND tick-capped
			// (`MAX_TICKS_PER_WARM`) so the dropped-frame window is bounded
			// regardless of node count.
			this.warmUp(Math.min(1, graph.reheat));
		}
	}

	/** Apply drag / pin overrides by node index. `fx === null` releases
	 *  the node back to the simulation. Implicit warmth is kept very low
	 *  (0.05): the calibration in `force-layout.ts` (velocityDecay 0.58,
	 *  maxSpeed 22) tames small-node oscillation at higher alpha, but at
	 *  0.3 two connected *large*-radius nodes still under-damped: springs
	 *  + collide + centroid-drift produced a visible orbit/shake as the
	 *  user dragged one of them. 0.05 makes the per-tick spring force
	 *  ~6× smaller — neighbours follow smoothly with no visible ring. */
	setFixed(items: ReadonlyArray<{ i: number; fx: number | null; fy: number | null }>): void {
		for (const it of items) {
			const node = this.nodes[it.i];
			if (!node) continue;
			node.fx = it.fx;
			node.fy = it.fy;
		}
		this.warmUp(0.05);
	}

	/** Advance one tick when warm. Returns whether the sim is still warm
	 *  after the step (false ⇒ caller may stop pumping). */
	step(): boolean {
		if (!this.warm) return false;
		this.advance();
		return true;
	}

	/** Run as many ticks as fit in `budgetMs`, then stop. This replaces the
	 *  old synchronous `preConverge`: the caller invokes it once per frame
	 *  so the simulation converges over a handful of frames *without ever
	 *  blocking the thread longer than the budget* — the profiler keeps
	 *  sampling and the UI keeps painting. Always does ≥1 tick when warm so
	 *  progress is guaranteed even if the clock is coarse. Returns whether
	 *  the sim is still warm. */
	stepFor(budgetMs: number): boolean {
		if (!this.warm) return false;
		const deadline = now() + Math.max(0, budgetMs);
		do {
			this.advance();
		} while (this.warm && now() < deadline);
		return this.warm;
	}

	/** Write the current `[x,y]*N` into `out` (length must be `2*nodeCount`).
	 *  Allocates a fresh array when `out` is omitted. */
	readPositions(out?: Float32Array): Float32Array {
		const buf =
			out && out.length >= this.nodes.length * 2 ? out : new Float32Array(this.nodes.length * 2);
		for (let i = 0; i < this.nodes.length; i += 1) {
			const n = this.nodes[i] as LayoutNode;
			buf[i * 2] = n.x;
			buf[i * 2 + 1] = n.y;
		}
		return buf;
	}
}
