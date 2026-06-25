import { describe, expect, it } from "vitest";
import {
	ALPHA_DECAY,
	ALPHA_MIN,
	BARNES_HUT_THRESHOLD,
	DEFAULT_LAYOUT_PARAMS,
	type LayoutEdge,
	type LayoutNode,
	coolDown,
	markOrphans,
	preConverge,
	scaleForCount,
	seedPositions,
	seededRng,
	spreadFactor,
	tickLayout,
} from "./force-layout";

describe("seededRng", () => {
	it("is deterministic for the same seed", () => {
		const a = seededRng(42);
		const b = seededRng(42);
		for (let i = 0; i < 10; i += 1) {
			expect(a()).toBe(b());
		}
	});

	it("produces different streams for different seeds", () => {
		const a = seededRng(1);
		const b = seededRng(2);
		const first10A = Array.from({ length: 10 }, a);
		const first10B = Array.from({ length: 10 }, b);
		expect(first10A).not.toEqual(first10B);
	});
});

describe("seedPositions", () => {
	it("places every node inside the canvas viewport", () => {
		const nodes = seedPositions(["a", "b", "c", "d", "e"], DEFAULT_LAYOUT_PARAMS);
		for (const node of nodes) {
			expect(node.x).toBeGreaterThanOrEqual(0);
			expect(node.x).toBeLessThanOrEqual(DEFAULT_LAYOUT_PARAMS.width);
			expect(node.y).toBeGreaterThanOrEqual(0);
			expect(node.y).toBeLessThanOrEqual(DEFAULT_LAYOUT_PARAMS.height);
		}
	});

	it("produces the same layout for the same seed", () => {
		const a = seedPositions(["a", "b", "c"], DEFAULT_LAYOUT_PARAMS, 7);
		const b = seedPositions(["a", "b", "c"], DEFAULT_LAYOUT_PARAMS, 7);
		expect(a.map((n) => n.x)).toEqual(b.map((n) => n.x));
		expect(a.map((n) => n.y)).toEqual(b.map((n) => n.y));
	});
});

describe("coolDown", () => {
	it("zeros all velocities", () => {
		const nodes = [
			{ id: "a", x: 0, y: 0, vx: 3, vy: -4, pinned: false, fx: null, fy: null, radius: 6 },
			{ id: "b", x: 0, y: 0, vx: -2, vy: 1, pinned: false, fx: null, fy: null, radius: 6 },
		];
		coolDown(nodes);
		for (const n of nodes) {
			expect(n.vx).toBe(0);
			expect(n.vy).toBe(0);
		}
	});
});

describe("preConverge", () => {
	it("leaves nodes at rest (vx/vy zero) so a reheat doesn't inherit momentum", () => {
		const nodes = seedPositions(["a", "b", "c", "d"], DEFAULT_LAYOUT_PARAMS, 1);
		const edges: LayoutEdge[] = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
			{ source: "c", target: "d" },
		];
		preConverge(nodes, edges, DEFAULT_LAYOUT_PARAMS);
		for (const n of nodes) {
			expect(n.vx).toBe(0);
			expect(n.vy).toBe(0);
		}
	});
});

describe("tickLayout", () => {
	it("pulls two connected nodes toward each other when they're far apart", () => {
		const a = { id: "a", x: 50, y: 300, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const b = { id: "b", x: 750, y: 300, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const nodes = [a, b];
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		const initialDist = b.x - a.x;
		for (let i = 0; i < 30; i += 1) tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS);
		const finalDist = b.x - a.x;
		expect(finalDist).toBeLessThan(initialDist);
	});

	it("snaps a node with fx/fy set to those coords every tick (drag pin)", () => {
		const a = { id: "a", x: 0, y: 0, vx: 0, vy: 0, pinned: false, fx: 400, fy: 300, radius: 6 };
		const b = { id: "b", x: 0, y: 0, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const nodes = [a, b];
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		for (let i = 0; i < 10; i += 1) tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS);
		expect(a.x).toBe(400);
		expect(a.y).toBe(300);
		expect(a.vx).toBe(0);
		expect(a.vy).toBe(0);
		// The unpinned neighbour is pulled toward the spring rest length.
		expect(b.x).not.toBe(0);
	});

	it("respects pinned nodes (they don't move)", () => {
		const a = { id: "a", x: 100, y: 100, vx: 0, vy: 0, pinned: true, fx: null, fy: null, radius: 6 };
		const b = { id: "b", x: 200, y: 200, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const nodes = [a, b];
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		for (let i = 0; i < 30; i += 1) tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS);
		expect(a.x).toBe(100);
		expect(a.y).toBe(100);
	});

	it("decays alpha toward zero on each tick", () => {
		const nodes = seedPositions(["a", "b"], DEFAULT_LAYOUT_PARAMS, 1);
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		let alpha = 1;
		for (let i = 0; i < 5; i += 1) {
			const next = tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS, alpha);
			expect(next).toBeLessThan(alpha);
			alpha = next;
		}
		expect(alpha).toBeCloseTo((1 - ALPHA_DECAY) ** 5, 5);
	});

	it("crosses ALPHA_MIN in a reasonable number of ticks (the loop has a stopping condition)", () => {
		// With ALPHA_DECAY ≈ 0.0228 this should take ~300 ticks; cap well
		// above so the test isn't flaky if constants are tweaked.
		const nodes = seedPositions(["a", "b", "c"], DEFAULT_LAYOUT_PARAMS, 1);
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		let alpha = 1;
		let ticks = 0;
		while (alpha > ALPHA_MIN && ticks < 2000) {
			alpha = tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS, alpha);
			ticks += 1;
		}
		expect(ticks).toBeLessThan(2000);
		expect(alpha).toBeLessThanOrEqual(ALPHA_MIN);
	});

	it("with alpha at zero, applies no forces (cooled layout is stationary)", () => {
		const a = { id: "a", x: 100, y: 100, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const b = { id: "b", x: 700, y: 500, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6 };
		const nodes = [a, b];
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS, 0);
		expect(a.x).toBe(100);
		expect(a.y).toBe(100);
		expect(b.x).toBe(700);
		expect(b.y).toBe(500);
	});

	it("separates two overlapping discs to at least their combined radii", () => {
		// Charge 0 isolates the collision force from repulsion. Two large
		// discs overlapping at the centre must be pushed apart to >= the
		// collision floor (r₁+r₂+pad), proving the dense central cluster
		// stops rendering as one opaque blob.
		const params = { ...DEFAULT_LAYOUT_PARAMS, charge: 0 };
		const a = {
			id: "a",
			x: 400,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 20,
		};
		const b = {
			id: "b",
			x: 405,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 20,
		};
		const nodes = [a, b];
		for (let i = 0; i < 60; i += 1) tickLayout(nodes, [], params, 1);
		const dist = Math.hypot(b.x - a.x, b.y - a.y);
		expect(dist).toBeGreaterThanOrEqual(a.radius + b.radius + params.collidePadding - 0.5);
	});

	it("collideStrength 0 leaves overlapping discs overlapping (force is opt-out)", () => {
		const params = { ...DEFAULT_LAYOUT_PARAMS, charge: 0, collideStrength: 0 };
		const a = {
			id: "a",
			x: 400,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 20,
		};
		const b = {
			id: "b",
			x: 405,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 20,
		};
		const nodes = [a, b];
		for (let i = 0; i < 60; i += 1) tickLayout(nodes, [], params, 1);
		expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(a.radius + b.radius);
	});

	it("collision is alpha-scaled: separates far more when hot than at drag-alpha", () => {
		// Drag pins the sim at alpha 0.05 to stay calm. Because collision
		// moves positions DIRECTLY (bypassing velocityDecay), it must scale
		// by alpha too — otherwise a drag reheat shoves neighbours apart at
		// full strength every tick and reintroduces shake. Same start, same
		// tick count, only alpha differs → hot must separate noticeably more.
		const params = { ...DEFAULT_LAYOUT_PARAMS, charge: 0 };
		const pair = () => [
			{ id: "a", x: 400, y: 300, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 20 },
			{ id: "b", x: 405, y: 300, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 20 },
		];
		const hot = pair();
		for (let i = 0; i < 8; i += 1) tickLayout(hot, [], params, 1);
		const cool = pair();
		for (let i = 0; i < 8; i += 1) tickLayout(cool, [], params, 0.05);
		const distHot = Math.abs((hot[1]?.x ?? 0) - (hot[0]?.x ?? 0));
		const distCool = Math.abs((cool[1]?.x ?? 0) - (cool[0]?.x ?? 0));
		expect(distHot).toBeGreaterThan(distCool);
	});

	it("collision never moves a fixed (dragged) node off its fx/fy", () => {
		// The drag invariant: while a node is pinned under the cursor it must
		// stay exactly there even as collision shoves its overlapping
		// neighbours aside. Regression guard for the drag-shake spec.
		const params = { ...DEFAULT_LAYOUT_PARAMS, charge: 0 };
		const fixed = {
			id: "f",
			x: 400,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: 400,
			fy: 300,
			radius: 20,
		};
		const nb = {
			id: "n",
			x: 406,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 20,
		};
		const nodes = [fixed, nb];
		for (let i = 0; i < 30; i += 1) tickLayout(nodes, [], params, 0.05);
		expect(fixed.x).toBe(400);
		expect(fixed.y).toBe(300);
	});

	it("skips repulsion for pairs beyond chargeDistanceMax", () => {
		const close = () => ({
			a: { id: "a", x: 100, y: 100, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 1 },
			b: { id: "b", x: 130, y: 100, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 1 },
		});
		const withCap = close();
		const withoutCap = close();
		tickLayout([withCap.a, withCap.b], [], { ...DEFAULT_LAYOUT_PARAMS, chargeDistanceMax: 10 }, 1);
		tickLayout(
			[withoutCap.a, withoutCap.b],
			[],
			{ ...DEFAULT_LAYOUT_PARAMS, chargeDistanceMax: 10_000 },
			1,
		);
		const distWithCap = withCap.b.x - withCap.a.x;
		const distWithoutCap = withoutCap.b.x - withoutCap.a.x;
		// Without the cap, repulsion pushes them apart further than with the cap.
		expect(distWithoutCap).toBeGreaterThan(distWithCap);
	});

	it("two big connected nodes settle to a stable distance instead of orbiting", () => {
		// Regression: with the old collide pass active, two large-radius
		// connected nodes had no stable equilibrium — spring rest-length
		// (100) vs collide-floor (r₁+r₂+2·pad ≈ 112+) fought every tick and
		// the pair perpetually orbited. After dropping `resolveCollisions`,
		// the spring alone owns the rest distance, so the pair converges.
		const big = (id: string, x: number) => ({
			id,
			x,
			y: 300,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 50,
			isOrphan: false,
		});
		const a = big("a", 200);
		const b = big("b", 320);
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		// Sustain alpha at a non-trivial level for many ticks to bracket
		// the warm-phase that previously orbited; then check the per-tick
		// motion has decayed to near-zero (stable).
		let prevDist = Math.hypot(b.x - a.x, b.y - a.y);
		let lastDelta = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 200; i += 1) {
			tickLayout([a, b], edges, DEFAULT_LAYOUT_PARAMS, 1);
			const dist = Math.hypot(b.x - a.x, b.y - a.y);
			lastDelta = Math.abs(dist - prevDist);
			prevDist = dist;
		}
		// Settled: per-tick distance change is sub-pixel after the warm
		// phase. (With the old collide pass this stayed > 1 px forever.)
		expect(lastDelta).toBeLessThan(0.5);
		// Sanity: the pair didn't fly off to infinity.
		expect(Number.isFinite(prevDist)).toBe(true);
		expect(prevDist).toBeGreaterThan(0);
	});

	it("clamps per-tick displacement so a far spring can't teleport a node", () => {
		// Two linked nodes 5000 px apart: the spring delta is ~4900 px, which
		// pre-clamp would fling `a` thousands of px in one tick and start a
		// back-and-forth oscillation. With the clamp the move is bounded to
		// maxSpeed regardless of how large the impulse is. Straddle the
		// canvas centre symmetrically so the centroid-drift recentre (a
		// rigid translation, not oscillation) is ~0 and we measure only the
		// spring-driven, clamp-bounded motion.
		const params = { ...DEFAULT_LAYOUT_PARAMS };
		const cx = params.width / 2;
		const cy = params.height / 2;
		const a = {
			id: "a",
			x: cx - 2500,
			y: cy,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 1,
		};
		const b = {
			id: "b",
			x: cx + 2500,
			y: cy,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 1,
		};
		const before = { x: a.x, y: a.y };
		tickLayout([a, b], [{ source: "a", target: "b" }], params, 1);
		const moved = Math.hypot(a.x - before.x, a.y - before.y);
		expect(moved).toBeLessThanOrEqual(params.maxSpeed + 1e-6);
		expect(moved).toBeGreaterThan(0);
	});

	it("keeps node positions bounded even after many ticks (no explosion)", () => {
		const nodes = seedPositions(["a", "b", "c", "d"], DEFAULT_LAYOUT_PARAMS, 1);
		const edges: LayoutEdge[] = [
			{ source: "a", target: "b" },
			{ source: "b", target: "c" },
			{ source: "c", target: "d" },
		];
		for (let i = 0; i < 200; i += 1) tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS);
		// Verlet under repulsion + springs + center-pull doesn't fully damp
		// (the system has standing kinetic energy from constant forces), so
		// the load-bearing invariant is "doesn't explode" — all nodes stay
		// within the canvas + a generous margin.
		const margin = 200;
		for (const node of nodes) {
			expect(node.x).toBeGreaterThan(-margin);
			expect(node.x).toBeLessThan(DEFAULT_LAYOUT_PARAMS.width + margin);
			expect(node.y).toBeGreaterThan(-margin);
			expect(node.y).toBeLessThan(DEFAULT_LAYOUT_PARAMS.height + margin);
		}
	});
});

describe("spreadFactor / scaleForCount (large-graph force balance)", () => {
	it("spreadFactor is 1 below the threshold and grows then caps at 1.85", () => {
		expect(spreadFactor(10)).toBe(1);
		expect(spreadFactor(BARNES_HUT_THRESHOLD - 1)).toBe(1);
		expect(spreadFactor(BARNES_HUT_THRESHOLD)).toBe(1);
		// √(4× threshold / threshold) = 2, but capped at 1.85.
		expect(spreadFactor(BARNES_HUT_THRESHOLD * 4)).toBe(1.85);
		expect(spreadFactor(50_000)).toBe(1.85);
		// Monotonic non-decreasing up to the cap.
		expect(spreadFactor(BARNES_HUT_THRESHOLD * 2)).toBeGreaterThan(1);
		expect(spreadFactor(BARNES_HUT_THRESHOLD * 2)).toBeLessThanOrEqual(1.85);
	});

	it("scaleForCount is the identity below the threshold", () => {
		const out = scaleForCount(DEFAULT_LAYOUT_PARAMS, 50);
		expect(out).toEqual(DEFAULT_LAYOUT_PARAMS);
	});

	it("lengthens springs and relaxes centre-pull for a large graph, leaving charge alone", () => {
		const out = scaleForCount(DEFAULT_LAYOUT_PARAMS, BARNES_HUT_THRESHOLD * 9);
		// Spring rest length grows by the (capped) spread factor.
		expect(out.linkDistance).toBeGreaterThan(DEFAULT_LAYOUT_PARAMS.linkDistance);
		expect(out.linkDistance).toBeCloseTo(DEFAULT_LAYOUT_PARAMS.linkDistance * 1.85, 5);
		// Centre-pull is relaxed (smaller) so the connected mass can spread.
		expect(out.centerStrength).toBeLessThan(DEFAULT_LAYOUT_PARAMS.centerStrength);
		// Charge is deliberately untouched (boosting it over-energises drags).
		expect(out.charge).toBe(DEFAULT_LAYOUT_PARAMS.charge);
	});

	it("seeds a large graph over a wider annulus so it starts near equilibrium", () => {
		// Same id count, but the large set must seed further from centre than a
		// handful of nodes would — the seed radius tracks `spreadFactor`.
		const small = seedPositions(["a", "b", "c"], DEFAULT_LAYOUT_PARAMS, 3);
		const bigIds = Array.from({ length: BARNES_HUT_THRESHOLD * 4 }, (_, i) => `n${i}`);
		const big = seedPositions(bigIds, DEFAULT_LAYOUT_PARAMS, 3);
		const cx = DEFAULT_LAYOUT_PARAMS.width / 2;
		const cy = DEFAULT_LAYOUT_PARAMS.height / 2;
		const maxR = (ns: LayoutNode[]): number =>
			Math.max(...ns.map((n) => Math.hypot(n.x - cx, n.y - cy)));
		expect(maxR(big)).toBeGreaterThan(maxR(small));
	});
});

describe("Barnes–Hut repulsion (large graphs)", () => {
	const makeCluster = (count: number, spreadPx: number): LayoutNode[] => {
		// Deterministic tight cluster near the canvas centre — every node
		// within `spreadPx` of the middle, no edges (pure repulsion test).
		const rng = seededRng(count + 1);
		const cx = DEFAULT_LAYOUT_PARAMS.width / 2;
		const cy = DEFAULT_LAYOUT_PARAMS.height / 2;
		return Array.from({ length: count }, (_, i) => ({
			id: `n${i}`,
			x: cx + (rng() * 2 - 1) * spreadPx,
			y: cy + (rng() * 2 - 1) * spreadPx,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: 4,
			isOrphan: true,
		}));
	};
	const medianRadius = (nodes: LayoutNode[]): number => {
		let cx = 0;
		let cy = 0;
		for (const n of nodes) {
			cx += n.x;
			cy += n.y;
		}
		cx /= nodes.length;
		cy /= nodes.length;
		const dists = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b);
		return dists[Math.floor(dists.length / 2)] ?? 0;
	};

	it("engages above the threshold and spreads a dense cluster outward", () => {
		// A clustered, edgeless graph at/above BARNES_HUT_THRESHOLD must use
		// the uncapped quadtree repulsion and visibly expand — this is the
		// fix for "all nodes stacked in the centre" at vault scale.
		const nodes = makeCluster(BARNES_HUT_THRESHOLD, 40);
		const before = medianRadius(nodes);
		let alpha = 1;
		for (let i = 0; i < 90; i += 1) alpha = tickLayout(nodes, [], DEFAULT_LAYOUT_PARAMS, alpha);
		const after = medianRadius(nodes);
		expect(after).toBeGreaterThan(before * 3);
		// No NaN / Infinity escaped the quadtree math.
		for (const n of nodes) {
			expect(Number.isFinite(n.x)).toBe(true);
			expect(Number.isFinite(n.y)).toBe(true);
		}
	});

	it("keeps connected nodes together while the cluster spreads (springs still bind)", () => {
		// Springs must still win locally: a tightly linked chain stays compact
		// even as the Barnes–Hut repulsion blows the rest of the cloud apart.
		const nodes = makeCluster(BARNES_HUT_THRESHOLD, 40);
		const edges: LayoutEdge[] = [
			{ source: "n0", target: "n1" },
			{ source: "n1", target: "n2" },
		];
		markOrphans(nodes, edges);
		let alpha = 1;
		for (let i = 0; i < 90; i += 1) alpha = tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS, alpha);
		const n0 = nodes.find((n) => n.id === "n0");
		const n1 = nodes.find((n) => n.id === "n1");
		if (!n0 || !n1) throw new Error("missing chain nodes");
		// Adjacent linked nodes settle near the spring rest length, not flung
		// to opposite ends of the spread cloud.
		const linked = Math.hypot(n1.x - n0.x, n1.y - n0.y);
		expect(linked).toBeLessThan(DEFAULT_LAYOUT_PARAMS.linkDistance * 3);
	});

	it("is deterministic for the same input (stable snapshot across list() calls)", () => {
		const a = makeCluster(BARNES_HUT_THRESHOLD, 40);
		const b = makeCluster(BARNES_HUT_THRESHOLD, 40);
		let alpha = 1;
		for (let i = 0; i < 30; i += 1) {
			alpha = tickLayout(a, [], DEFAULT_LAYOUT_PARAMS, 1);
		}
		for (let i = 0; i < 30; i += 1) {
			tickLayout(b, [], DEFAULT_LAYOUT_PARAMS, 1);
		}
		for (let i = 0; i < a.length; i += 1) {
			expect(a[i]?.x).toBeCloseTo(b[i]?.x ?? Number.NaN, 6);
			expect(a[i]?.y).toBeCloseTo(b[i]?.y ?? Number.NaN, 6);
		}
	});
});

describe("markOrphans", () => {
	it("marks nodes with no incident edges as orphans", () => {
		const nodes = seedPositions(["a", "b", "c"], DEFAULT_LAYOUT_PARAMS, 1);
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		markOrphans(nodes, edges);
		expect(nodes.find((n) => n.id === "a")?.isOrphan).toBe(false);
		expect(nodes.find((n) => n.id === "b")?.isOrphan).toBe(false);
		expect(nodes.find((n) => n.id === "c")?.isOrphan).toBe(true);
	});

	it("clears the orphan flag when an edge is added", () => {
		const nodes = seedPositions(["a", "b"], DEFAULT_LAYOUT_PARAMS, 1);
		markOrphans(nodes, []);
		expect(nodes.every((n) => n.isOrphan)).toBe(true);
		markOrphans(nodes, [{ source: "a", target: "b" }]);
		expect(nodes.every((n) => !n.isOrphan)).toBe(true);
	});

	it("lets non-orphans drift to centre while orphans hold their ring position", () => {
		// One connected pair + one orphan far from centre. After many
		// ticks the pair should be near centre; the orphan should remain
		// far from centre because the per-node forceX/forceY pull is zero
		// for orphans.
		const nodes = seedPositions(["a", "b", "orphan"], DEFAULT_LAYOUT_PARAMS, 1);
		const orphan = nodes.find((n) => n.id === "orphan");
		const a = nodes.find((n) => n.id === "a");
		if (!orphan || !a) throw new Error("seedPositions missing requested nodes");
		orphan.x = 10;
		orphan.y = 10;
		const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
		markOrphans(nodes, edges);
		for (let i = 0; i < 300; i += 1) tickLayout(nodes, edges, DEFAULT_LAYOUT_PARAMS, 1);
		const cx = DEFAULT_LAYOUT_PARAMS.width / 2;
		const cy = DEFAULT_LAYOUT_PARAMS.height / 2;
		const orphanFromCentre = Math.hypot(orphan.x - cx, orphan.y - cy);
		const aFromCentre = Math.hypot(a.x - cx, a.y - cy);
		// Orphan stays farther from centre than the connected node.
		expect(orphanFromCentre).toBeGreaterThan(aFromCentre);
	});
});
