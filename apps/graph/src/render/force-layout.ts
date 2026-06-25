/**
 * Tiny force-directed layout — Verlet integration with these forces:
 *   - Repulsion between every pair (n² but bounded by node cap).
 *   - Spring attraction along every edge.
 *   - A weak pull toward the canvas center.
 *   - Collision separation so overlapping discs push apart (`applyCollision`).
 *
 * No d3 dep — that lands at 9.13.5 alongside the pixi renderer. Per the
 * [[avoid-blocking-on-deps]] memory, this plain-DOM minimum proves the
 * shape; the d3 swap is later.
 *
 * The simulation is deterministic given a seeded initial layout: the
 * `seed` parameter to `seedPositions` controls the starting positions,
 * so two renderers with the same seed converge to similar layouts.
 */

export type NodeId = string;

export type LayoutNode = {
	id: NodeId;
	x: number;
	y: number;
	vx: number;
	vy: number;
	pinned: boolean;
	/** d3-force-style fixed coords. While set, the node snaps to `(fx, fy)`
	 *  every tick and its velocity is zeroed — used to pin a node under
	 *  the cursor during drag without taking it out of the simulation.
	 *  Setting them back to `null` releases the node. */
	fx: number | null;
	fy: number | null;
	/** Visible radius — read by the collision force so overlapping nodes
	 *  hard-separate. Defaults to a constant on `seedPositions`; the
	 *  scene reconciliation writes the real per-node value so degree-aware
	 *  sizing actually affects layout. */
	radius: number;
	/** True when the node has zero incident edges. Orphans get zero pull
	 *  from the per-node centre spring so they drift to the periphery
	 *  instead of stacking on the centre column. Recomputed by
	 *  `markOrphans()` whenever edges change. Optional so callers that
	 *  pre-date this flag (and the existing tests) keep working unchanged
	 *  — `undefined` reads as "not an orphan, pull applies", matching the
	 *  prior behaviour. */
	isOrphan?: boolean;
};

export type LayoutEdge = {
	source: NodeId;
	target: NodeId;
};

export type LayoutParams = {
	width: number;
	height: number;
	/** Repulsion strength (negative number). */
	charge: number;
	/** Above this pairwise distance, repulsion is skipped (the
	 *  conventional `charge.distanceMax` cap). Without a cap, far-away
	 *  nodes still push each other and the layout never settles. */
	chargeDistanceMax: number;
	/** Spring rest-length. */
	linkDistance: number;
	/** Velocity decay per frame 0..1. d3-force's default is 0.4; lower
	 *  than that leaves enough residual momentum to read as jiggle. */
	velocityDecay: number;
	/** Center-pull strength. */
	centerStrength: number;
	/** Hard cap on how far a node may move in one tick, in px. The spring
	 *  force is `delta * strength * alpha` with no bound on `delta`, so a
	 *  node far from its rest length gets a single-tick impulse of hundreds
	 *  of px, overshoots, and the spring yanks it back just as hard — a
	 *  sustained high-amplitude jiggle in dense clusters. Clamping post-decay
	 *  speed to ~one rest-length per tick removes the explosion without
	 *  shifting the equilibrium the forces converge to (near rest, per-tick
	 *  motion is a few px and the clamp never binds). */
	maxSpeed: number;
	/** Extra gap (px) enforced between two node *edges* beyond the sum of
	 *  their radii. The collision floor is `r₁+r₂+collidePadding`. */
	collidePadding: number;
	/** How aggressively per-tick overlap is resolved, 0..1. 1 pushes two
	 *  overlapping discs fully apart in one tick; lower relaxes over a few
	 *  ticks (smoother, less popping). */
	collideStrength: number;
};

/** Default force parameters. Six forces in the standard d3-force
 *  shape — `link` / `charge` / `center` (centroid drift correction) /
 *  `forceX` (per-node x-spring; **zero strength for orphan nodes**) /
 *  `forceY` (same on y) / `collide`. The earlier build shipped **without**
 *  `forceCollide` because, when node radii could reach ~50, the collide
 *  floor (`r₁+r₂+pad` ≈ 112) exceeded the spring rest-length (100) and the
 *  two forces fought into a slow orbit. With radii now clamped to
 *  MAX_RADIUS 22 the collide floor (≤ ~50) sits well *inside* the spring
 *  rest-length, so the two act in disjoint distance bands and never fight
 *  — and `applyCollision` resolves on *positions* (not velocities), so it
 *  injects no momentum for the springs to ring against. Collision back on:
 *  the dense central cluster now reads as separated discs instead of one
 *  opaque blob. */
export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
	width: 800,
	height: 600,
	// Spread defaults: stronger, longer-range repulsion + longer links +
	// weaker centre pull than the original (-250 / 1000 / 100 / 0.01) so a
	// dense, highly-connected vault opens as a readable spread instead of a
	// tight central ball. All eight are user-tunable in Settings → Forces.
	charge: -300,
	chargeDistanceMax: 1400,
	linkDistance: 130,
	// Heavier damping than d3's 0.4 default. The drag shake of boxed
	// nodes is an under-damped global sim: springs pull neighbours toward
	// the dragged node, low decay lets that energy ring. 0.58 bleeds it
	// off fast so the graph settles smoothly.
	velocityDecay: 0.58,
	centerStrength: 0.006,
	// Cap per-tick travel low: a fixed (dragged) node yanking a stiff
	// spring could fling a neighbour ~40px in one tick → the visible
	// "shake". 22 keeps neighbour motion smooth.
	maxSpeed: 22,
	collidePadding: 2,
	collideStrength: 0.85,
};

/** Cooling constants. With `alphaDecay=0.05, alphaMin=0.01` the
 *  simulation comes to rest in ~90 ticks (~1.5s @ 60 fps) — vs the d3
 *  defaults (~300 ticks, ~5s) which the user explicitly called too long.
 *  The right UX is `preConverge` below, which runs those 90 ticks
 *  *synchronously* before first paint so the user never sees them. */
export const ALPHA_MIN = 0.01;
export const ALPHA_DECAY = 0.05;
/** Max iterations for a synchronous warm-start. */
export const PRECONVERGE_MAX_ITERATIONS = 300;

/** Seeded RNG (mulberry32) so initial positions are reproducible across runs. */
export function seededRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Default visible radius for a freshly-seeded node. The scene
 *  reconciliation overwrites this with the real degree-aware value. */
export const DEFAULT_NODE_RADIUS = 6;

/** Lay nodes out in a deterministic Vogel sunflower over an outer
 *  annulus — `r = inner + (outer − inner) · √t, θ = i · goldenAngle`.
 *  Spreads the seed across an annulus rather than a single ring, which
 *  matters whenever a large batch lands at once (loading a vault, a
 *  playback tick that reveals many entities in one frame): on a single
 *  ring N orphans push each other symmetrically and never net-separate
 *  before the sim cools, so they freeze in a tight tangential pile
 *  (visible in dense vaults as regular grid-clusters of orphan dots).
 *  The annular sunflower distributes pair-distances by *radius too*,
 *  giving charge + collision room to actually resolve. The inner
 *  cutoff at ~30 % of `min(w,h)` keeps incremental seeds clear of the
 *  already-laid-out cluster at canvas centre, so new nodes don't seed
 *  on top of existing ones. Deterministic given a seed. */
export function seedPositions(ids: NodeId[], params: LayoutParams, seedRandom = 1): LayoutNode[] {
	const rng = seededRng(seedRandom);
	const cx = params.width / 2;
	const cy = params.height / 2;
	const shortSide = Math.min(params.width, params.height);
	// Scale the seed annulus by the same factor `scaleForCount` spreads the
	// equilibrium: a large vault settles to a ~`spread`× larger cluster, so
	// seeding at that radius (not the demo 0.3–0.55 ring) lands nodes near
	// their final positions. The fast converge then has little distance to
	// travel and reaches true rest — so the first drag releases no pent-up
	// settling drift (the alternative — slowing the cooldown so a tight seed
	// can crawl out to equilibrium — left the graph visibly churning for
	// seconds and the first drag grabbing a still-moving node).
	const spread = spreadFactor(ids.length);
	const inner = shortSide * 0.3 * spread;
	const outer = shortSide * 0.55 * spread;
	const span = outer - inner;
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	const n = Math.max(1, ids.length);
	return ids.map((id, i) => {
		const t = (i + 0.5) / n;
		const r = inner + span * Math.sqrt(t);
		const angle = i * goldenAngle;
		// Small absolute jitter (not radius-scaled) so two identical-r
		// neighbours on the spiral don't sit on the exact same circle.
		const jx = rng() * 6 - 3;
		const jy = rng() * 6 - 3;
		return {
			id,
			x: cx + Math.cos(angle) * r + jx,
			y: cy + Math.sin(angle) * r + jy,
			vx: 0,
			vy: 0,
			pinned: false,
			fx: null,
			fy: null,
			radius: DEFAULT_NODE_RADIUS,
			// `markOrphans` overrides this with the real value once edges
			// are known. Default `true` means a freshly-seeded node with
			// no edges yet gets zero centre-pull.
			isOrphan: true,
		};
	});
}

/** Recompute `isOrphan` on every node from the current edge set. An
 *  orphan is a node with zero incident edges. Call this whenever the
 *  edge set changes (topology reconciliation, preset switch) — the
 *  forceX / forceY pull reads this flag every tick. */
export function markOrphans(nodes: LayoutNode[], edges: LayoutEdge[]): void {
	const hasEdge = new Set<NodeId>();
	for (const e of edges) {
		hasEdge.add(e.source);
		hasEdge.add(e.target);
	}
	for (const node of nodes) {
		node.isOrphan = !hasEdge.has(node.id);
	}
}

/** Derive a node-count-aware force balance from the configured params.
 *  The defaults are tuned for a demo-sized graph; at vault scale (thousands
 *  of nodes) the same numbers collapse the connected component into a
 *  central ball. We scale the repulsion *up* and the per-node centre-pull
 *  *down* with √(N / threshold) so a dense graph opens into a readable
 *  layout — the connected mass expands instead of piling on the centre,
 *  while the orphan ring (already centre-pull-free) is unaffected by the
 *  centre term. A no-op below the threshold, so small graphs keep the exact
 *  equilibrium the unit tests assert. The user's force sliders still set the
 *  base values this multiplies. Clamped so a pathological vault can't fling
 *  the cloud past the camera's reach. */
/** The node-count → spread multiplier shared by the spring rest length
 *  (`scaleForCount`) and the initial seed radius (`seedPositions`) — the two
 *  must use the SAME factor so nodes seed at their force equilibrium. 1 below
 *  the Barnes–Hut threshold (small graphs unchanged), then √(N/threshold).
 *  Capped at 1.85, NOT because a bigger graph couldn't open wider, but
 *  because longer springs leave proportionally more settling residual that
 *  the drag-reheat releases as neighbour motion — past ~×1.85 it crosses the
 *  `graph-drag-shake` spec's 10 px/sample ceiling (×1.6→6.9, ×2.4→13.5).
 *  Extra spread beyond this comes from the drag-free centre-pull lever. */
export function spreadFactor(nodeCount: number): number {
	if (nodeCount < BARNES_HUT_THRESHOLD) return 1;
	return Math.min(1.85, Math.sqrt(nodeCount / BARNES_HUT_THRESHOLD));
}

/** Uncapped √ factor for the drag-free levers (centre-pull). Relaxing the
 *  per-node centre-pull opens the connected mass without adding any
 *  drag-time impulse (it pulls toward the canvas centre, not between
 *  neighbours), so it can scale past the spring cap. Clamped to 4. */
function centerSpreadFactor(nodeCount: number): number {
	if (nodeCount < BARNES_HUT_THRESHOLD) return 1;
	return Math.min(4, Math.sqrt(nodeCount / BARNES_HUT_THRESHOLD));
}

export function scaleForCount(params: LayoutParams, nodeCount: number): LayoutParams {
	if (nodeCount < BARNES_HUT_THRESHOLD) return params;
	const spread = spreadFactor(nodeCount);
	const centerSpread = centerSpreadFactor(nodeCount);
	return {
		...params,
		// Open the dense connected core at vault scale with the two levers that
		// set WHERE the layout settles without over-energising a drag:
		//   • Longer springs (×spread) de-densify the mesh from within — the
		//     lever that actually matters (centre-pull alone leaves intra-mesh
		//     spacing at `linkDistance`, so the core stays a blob). At rest the
		//     spring delta≈0, so once settled it adds no drag-time impulse.
		//   • Weaker centre-pull (÷spread²) stops the connected mass piling on
		//     the middle (orphans already ignore this canvas-centre term).
		// `charge` is deliberately NOT boosted: stronger repulsion makes the
		// drag-pinned node shove its neighbours at the low drag-reheat alpha
		// (14 px/sample — over the drag-shake ceiling). The spread comes from
		// the springs + the matching wider seed in `seedPositions`, which lands
		// nodes near this equilibrium so the fast converge reaches true rest and
		// the first drag releases no pent-up settling drift.
		linkDistance: params.linkDistance * spread,
		centerStrength: params.centerStrength / (centerSpread * centerSpread),
	};
}

/** One simulation step. Forces are scaled by `alpha` (0..1) so the system
 *  cools to a stop instead of running forever — without it, repulsion +
 *  springs + center-pull maintain a kinetic-energy plateau and the layout
 *  visibly jitters indefinitely. Returns the alpha for the next tick; the
 *  caller stops ticking once it falls below `ALPHA_MIN`. Defaults to 1 so
 *  legacy callers (and existing tests) get the uncooled behaviour. */
export function tickLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	params: LayoutParams,
	alpha = 1,
): number {
	const degreeMap = buildDegreeMap(nodes, edges);
	// Large graphs need a different force balance than the demo-sized defaults.
	// At ~2k nodes the per-node centre-pull + springs overwhelm the (weak,
	// demo-tuned) repulsion, so the connected component collapses into a tight
	// central ball while only the pull-free orphans ring the outside — the
	// "all nodes stacked in the middle" report. `scaleForCount` boosts
	// repulsion and relaxes the centre-pull in proportion to N so the
	// connected mass opens into a readable layout. No-op below the threshold,
	// so the small-graph (tested) equilibrium is unchanged.
	const eff = scaleForCount(params, nodes.length);
	// Repulsion is the hot pass. The exact all-pairs version is O(N²); above
	// `BARNES_HUT_THRESHOLD` we switch to an O(N log N) Barnes–Hut quadtree so
	// the stronger long-range repulsion above is actually affordable.
	if (nodes.length >= BARNES_HUT_THRESHOLD) applyRepulsionBarnesHut(nodes, eff, alpha);
	else applyRepulsion(nodes, eff, alpha);
	applySprings(nodes, edges, eff, alpha, degreeMap);
	applyCenterPerNode(nodes, eff, alpha);
	integrate(nodes, params);
	applyCollision(nodes, params, alpha);
	applyCentroidDrift(nodes, params);
	return alpha + (0 - alpha) * ALPHA_DECAY;
}

/** Zero out residual velocities. Use after `preConverge` to guarantee that
 *  if anything later reheats the simulation (drag, settings change) it
 *  starts from rest instead of inheriting whatever momentum the cooled
 *  layout happened to leave on the table. (Equivalent to a d3
 *  `simulation.stop()`.) */
export function coolDown(nodes: LayoutNode[]): void {
	for (const node of nodes) {
		node.vx = 0;
		node.vy = 0;
	}
}

function applyRepulsion(nodes: LayoutNode[], params: LayoutParams, alpha: number): void {
	const maxSq = params.chargeDistanceMax * params.chargeDistanceMax;
	for (let i = 0; i < nodes.length; i += 1) {
		const a = nodes[i];
		if (!a) continue;
		for (let j = i + 1; j < nodes.length; j += 1) {
			const b = nodes[j];
			if (!b) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distSq = dx * dx + dy * dy + 1; // +1 to avoid singularity
			if (distSq > maxSq) continue;
			const force = (params.charge * alpha) / distSq;
			const dist = Math.sqrt(distSq);
			// `force` is negative when `charge` is negative (the conventional
			// repulsion config). The (dx, dy)/dist unit vector points a→b, so
			// for repulsion we want `a` to slide *away* from b — i.e. against
			// the unit vector. Add the (negative) force to a's velocity in the
			// a→b direction; subtract from b's. The previous sign here made
			// repulsion behave like attraction and produced a collapsing
			// cluster that obscured node sizing.
			const fx = (dx / dist) * force;
			const fy = (dy / dist) * force;
			if (!a.pinned) {
				a.vx += fx;
				a.vy += fy;
			}
			if (!b.pinned) {
				b.vx -= fx;
				b.vy -= fy;
			}
		}
	}
}

/** Node count at/above which `tickLayout` swaps the exact O(N²) repulsion
 *  for the Barnes–Hut quadtree. Below this the all-pairs pass is both fast
 *  enough and the behaviour the existing tests assert, so we leave it. */
export const BARNES_HUT_THRESHOLD = 400;

/** Barnes–Hut opening angle, squared (θ = 0.9 → θ² = 0.81 — d3-force's
 *  default). A cell is treated as a single body when `cellSize² / dist² <
 *  θ²`; smaller θ is more accurate and slower. */
const BARNES_HUT_THETA_SQ = 0.81;

/** Hardest recursion depth for the quadtree build. Coincident / near-
 *  coincident nodes would otherwise subdivide forever; past this depth a
 *  leaf just accumulates every body into its centre of mass. */
const QUADTREE_MAX_DEPTH = 22;

type QuadCell = {
	/** Square region this cell covers. */
	x0: number;
	y0: number;
	size: number;
	/** Centre-of-mass + body count of everything under this cell. All bodies
	 *  carry equal charge, so `count` is the charge multiplier. */
	cx: number;
	cy: number;
	count: number;
	/** Four quadrants (NW, NE, SW, SE) once subdivided, else null. */
	children: [QuadCell | null, QuadCell | null, QuadCell | null, QuadCell | null] | null;
};

function makeCell(x0: number, y0: number, size: number): QuadCell {
	return { x0, y0, size, cx: 0, cy: 0, count: 0, children: null };
}

function quadrantIndex(cell: QuadCell, x: number, y: number): number {
	const mid = cell.size / 2;
	const east = x >= cell.x0 + mid ? 1 : 0;
	const south = y >= cell.y0 + mid ? 1 : 0;
	return south * 2 + east;
}

function insertBody(root: QuadCell, x: number, y: number): void {
	let cell = root;
	let depth = 0;
	// Walk down, accumulating the centre of mass at every level. A leaf is a
	// cell with `count === 0` (empty) or one that holds bodies but hasn't been
	// subdivided yet (`children === null` with `count >= 1`).
	for (;;) {
		// Fold this body into the running centre of mass of the cell.
		cell.cx = (cell.cx * cell.count + x) / (cell.count + 1);
		cell.cy = (cell.cy * cell.count + y) / (cell.count + 1);
		cell.count += 1;
		if (cell.count === 1) return; // was empty — now a single-body leaf, done
		if (depth >= QUADTREE_MAX_DEPTH) return; // bottomed out — leaf holds many bodies as one COM
		if (!cell.children) {
			cell.children = [null, null, null, null];
			// The body already living here (count was 1 before this insert) is
			// represented by the cell's pre-insert COM. Re-seat it into a child
			// so the two bodies separate. Its position was the COM before we
			// folded `(x,y)` in; recover it from the two-body average.
			const px = cell.cx * 2 - x;
			const py = cell.cy * 2 - y;
			const half = cell.size / 2;
			const qi = quadrantIndex(cell, px, py);
			const child = childCell(cell, qi, half);
			cell.children[qi] = child;
			child.cx = px;
			child.cy = py;
			child.count = 1;
		}
		const half = cell.size / 2;
		const qi = quadrantIndex(cell, x, y);
		const existing = cell.children[qi];
		if (existing) {
			cell = existing;
		} else {
			const child = childCell(cell, qi, half);
			cell.children[qi] = child;
			cell = child;
		}
		depth += 1;
	}
}

function childCell(parent: QuadCell, qi: number, half: number): QuadCell {
	const east = qi & 1;
	const south = qi >> 1;
	return makeCell(parent.x0 + (east ? half : 0), parent.y0 + (south ? half : 0), half);
}

/** Barnes–Hut repulsion: build a quadtree over the node positions, then for
 *  each node accumulate the charge force, approximating any cell that's far
 *  enough away (per the θ criterion) as a single body at its centre of mass.
 *  Uncapped on purpose — long-range repulsion is what spreads a dense graph;
 *  the quadtree keeps it affordable at O(N log N). Same sign convention and
 *  per-tick `alpha` scaling as `applyRepulsion`. */
function applyRepulsionBarnesHut(nodes: LayoutNode[], params: LayoutParams, alpha: number): void {
	if (nodes.length < 2) return;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const n of nodes) {
		if (n.x < minX) minX = n.x;
		if (n.y < minY) minY = n.y;
		if (n.x > maxX) maxX = n.x;
		if (n.y > maxY) maxY = n.y;
	}
	// Square root region covering every body (+1 so a degenerate all-same-x
	// or single-column cloud still has positive size).
	const size = Math.max(maxX - minX, maxY - minY) + 1;
	const root = makeCell(minX, minY, size);
	for (const n of nodes) insertBody(root, n.x, n.y);

	const chargeAlpha = params.charge * alpha;
	const thetaSq = BARNES_HUT_THETA_SQ;
	// Iterative DFS over the tree per node — no recursion, no per-step closure
	// allocation. `stack` is reused across nodes.
	const stack: QuadCell[] = [];
	for (const node of nodes) {
		if (node.pinned) continue;
		let fx = 0;
		let fy = 0;
		stack.length = 0;
		stack.push(root);
		while (stack.length > 0) {
			const cell = stack.pop() as QuadCell;
			if (cell.count === 0) continue;
			const dx = cell.cx - node.x;
			const dy = cell.cy - node.y;
			const distSq = dx * dx + dy * dy + 1; // +1 avoids the singularity
			// Far enough, or a leaf: treat the whole cell as one body of mass
			// `count`. The (cell.size² / distSq < θ²) test is the Barnes–Hut
			// opening criterion; a childless cell always passes (it IS a body).
			if (cell.children === null || (cell.size * cell.size) / distSq < thetaSq) {
				const dist = Math.sqrt(distSq);
				const force = (chargeAlpha * cell.count) / distSq;
				fx += (dx / dist) * force;
				fy += (dy / dist) * force;
				continue;
			}
			const c = cell.children;
			if (c[0]) stack.push(c[0]);
			if (c[1]) stack.push(c[1]);
			if (c[2]) stack.push(c[2]);
			if (c[3]) stack.push(c[3]);
		}
		node.vx += fx;
		node.vy += fy;
	}
}

/** Per-edge spring stiffness matching d3-force's `forceLink` default:
 *  `1 / min(deg(source), deg(target))`. Hubs (high degree) get weaker
 *  springs so they don't get yanked toward every neighbour; leaf nodes
 *  get stiff springs so they sit near their one anchor. */
function degreeAwareLinkStrength(degreeBySource: Map<NodeId, number>, edge: LayoutEdge): number {
	const ds = degreeBySource.get(edge.source) ?? 1;
	const dt = degreeBySource.get(edge.target) ?? 1;
	return 1 / Math.max(1, Math.min(ds, dt));
}

function buildDegreeMap(nodes: LayoutNode[], edges: LayoutEdge[]): Map<NodeId, number> {
	const out = new Map<NodeId, number>();
	for (const n of nodes) out.set(n.id, 0);
	for (const e of edges) {
		out.set(e.source, (out.get(e.source) ?? 0) + 1);
		out.set(e.target, (out.get(e.target) ?? 0) + 1);
	}
	return out;
}

function applySprings(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	params: LayoutParams,
	alpha: number,
	degreeMap: Map<NodeId, number>,
): void {
	const byId = new Map(nodes.map((n) => [n.id, n] as const));
	for (const edge of edges) {
		const a = byId.get(edge.source);
		const b = byId.get(edge.target);
		if (!a || !b) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dist = Math.sqrt(dx * dx + dy * dy + 0.0001);
		const delta = dist - params.linkDistance;
		const strength = degreeAwareLinkStrength(degreeMap, edge);
		const factor = delta * strength * alpha;
		const fx = (dx / dist) * factor;
		const fy = (dy / dist) * factor;
		if (!a.pinned) {
			a.vx += fx;
			a.vy += fy;
		}
		if (!b.pinned) {
			b.vx -= fx;
			b.vy -= fy;
		}
	}
}

/** Per-node x/y spring toward the canvas centre — the d3-force
 *  `forceX` + `forceY` shape. Orphan nodes (zero incident edges) are
 *  not pulled — they drift to the periphery so the cluster of connected
 *  nodes stays readable in the middle. */
function applyCenterPerNode(nodes: LayoutNode[], params: LayoutParams, alpha: number): void {
	const cx = params.width / 2;
	const cy = params.height / 2;
	for (const node of nodes) {
		if (node.pinned || node.isOrphan) continue;
		node.vx += (cx - node.x) * params.centerStrength * alpha;
		node.vy += (cy - node.y) * params.centerStrength * alpha;
	}
}

/** Collision separation — d3 `forceCollide` in spirit, but resolved on
 *  *positions* after integration rather than on velocities, so it adds no
 *  momentum that the springs could ring against. Any two discs closer than
 *  `r₁+r₂+collidePadding` are pushed apart along their centre line, each by
 *  half the overlap scaled by `collideStrength`. A pinned / drag-fixed node
 *  holds station and its partner takes the full push, so dragging a node
 *  shoves neighbours aside without the node itself drifting off the cursor.
 *  O(n²), same order as the repulsion pass. Two exactly-coincident nodes
 *  (distSq 0, no defined direction) are left for the next tick's jitter /
 *  repulsion to separate.
 *
 *  Scaled by `alpha` like every other force: full separation while the
 *  layout is hot (initial converge), near-nothing once cool. This is what
 *  keeps a *drag* calm — the drag handler pins the sim at alpha 0.05, and
 *  because collision moves positions *directly* (bypassing `velocityDecay`),
 *  an unscaled pass would shove the dragged node's neighbours at full
 *  strength every tick and reintroduce the very shake the low drag-alpha
 *  exists to prevent. */
function applyCollision(nodes: LayoutNode[], params: LayoutParams, alpha: number): void {
	const strength = params.collideStrength * alpha;
	if (strength <= 0 || nodes.length < 2) return;
	const pad = params.collidePadding;
	// Uniform spatial grid keyed by cell so each node only tests the 3×3
	// neighbourhood of cells around it, not every other node. Cell size =
	// the largest possible collision diameter, so two nodes can only overlap
	// when they share a cell or sit in adjacent cells. This is ~O(n) vs the
	// O(n²) all-pairs scan — on a ~1k-node vault the all-pairs version
	// doubled the hottest per-tick loop and, because a drag keeps the sim
	// continuously hot, saturated the main-thread simulation.
	let maxRadius = 0;
	for (const n of nodes) if (n.radius > maxRadius) maxRadius = n.radius;
	const cell = Math.max(1, maxRadius * 2 + pad);
	// Pack signed cell coords into one integer key. ±32k cells covers any
	// laid-out graph; the rare out-of-range node just shares a bucket
	// (still correct, marginally less efficient).
	const keyOf = (x: number, y: number): number =>
		(((Math.floor(x / cell) & 0xffff) >>> 0) << 16) | ((Math.floor(y / cell) & 0xffff) >>> 0);
	const grid = new Map<number, number[]>();
	for (let i = 0; i < nodes.length; i += 1) {
		const n = nodes[i];
		if (!n) continue;
		const k = keyOf(n.x, n.y);
		const bucket = grid.get(k);
		if (bucket) bucket.push(i);
		else grid.set(k, [i]);
	}
	for (let i = 0; i < nodes.length; i += 1) {
		const a = nodes[i];
		if (!a) continue;
		const gx = Math.floor(a.x / cell);
		const gy = Math.floor(a.y / cell);
		for (let dxc = -1; dxc <= 1; dxc += 1) {
			for (let dyc = -1; dyc <= 1; dyc += 1) {
				const k = ((((gx + dxc) & 0xffff) >>> 0) << 16) | (((gy + dyc) & 0xffff) >>> 0);
				const bucket = grid.get(k);
				if (!bucket) continue;
				for (const j of bucket) {
					// Each unordered pair resolved exactly once.
					if (j <= i) continue;
					const b = nodes[j];
					if (!b) continue;
					const minDist = a.radius + b.radius + pad;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const distSq = dx * dx + dy * dy;
					if (distSq >= minDist * minDist || distSq === 0) continue;
					const dist = Math.sqrt(distSq);
					const push = ((minDist - dist) / dist) * strength;
					const ox = dx * push * 0.5;
					const oy = dy * push * 0.5;
					const aFixed = a.pinned || a.fx !== null || a.fy !== null;
					const bFixed = b.pinned || b.fx !== null || b.fy !== null;
					if (aFixed && bFixed) continue;
					if (aFixed) {
						b.x += ox * 2;
						b.y += oy * 2;
					} else if (bFixed) {
						a.x -= ox * 2;
						a.y -= oy * 2;
					} else {
						a.x -= ox;
						a.y -= oy;
						b.x += ox;
						b.y += oy;
					}
				}
			}
		}
	}
}

/** Centroid drift correction, matching d3's `forceCenter`. Shifts the
 *  free nodes so the cluster's centroid lands at the canvas centre —
 *  without it, repulsion + spring drift slowly walk the whole graph off
 *  one edge of the viewport. Runs *after* integration so it corrects
 *  the post-tick positions, never the velocities.
 *
 *  The centroid is summed over **every** node, including the
 *  drag-fixed / pinned ones (d3's `forceCenter` does the same). That is
 *  load-bearing: if fixed nodes were excluded, dragging one node would
 *  compute the centroid over only the *other* nodes — which the drag is
 *  actively perturbing through springs — so it lurched every tick and
 *  the full-strength correction teleported the whole free set (the far
 *  side visibly "shook"). With the dragged node *in* the centroid it
 *  anchors it: the per-tick delta collapses to sub-pixel and the far
 *  side stays put. With nothing fixed this is identical to before
 *  (centroid-of-all == centroid-of-free, full recenter). The shift is
 *  still applied only to free nodes so it never fights the pointer or
 *  moves a user-placed pin. */
function applyCentroidDrift(nodes: LayoutNode[], params: LayoutParams): void {
	const cx = params.width / 2;
	const cy = params.height / 2;
	let sx = 0;
	let sy = 0;
	if (nodes.length === 0) return;
	for (const node of nodes) {
		sx += node.x;
		sy += node.y;
	}
	const shiftX = cx - sx / nodes.length;
	const shiftY = cy - sy / nodes.length;
	for (const node of nodes) {
		if (node.pinned || node.fx !== null || node.fy !== null) continue;
		node.x += shiftX;
		node.y += shiftY;
	}
}

function integrate(nodes: LayoutNode[], params: LayoutParams): void {
	for (const node of nodes) {
		if (node.pinned) continue;
		// d3-force semantics: `fx`/`fy` override the integrator, so a dragged
		// node tracks the cursor exactly while other forces still react to it.
		const xFixed = node.fx !== null;
		const yFixed = node.fy !== null;
		if (xFixed) {
			node.x = node.fx as number;
			node.vx = 0;
		} else {
			node.vx *= 1 - params.velocityDecay;
		}
		if (yFixed) {
			node.y = node.fy as number;
			node.vy = 0;
		} else {
			node.vy *= 1 - params.velocityDecay;
		}
		// Clamp combined speed before it moves the node — a single
		// unbounded spring impulse must not teleport a node across the
		// canvas and kick off a back-and-forth oscillation.
		const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
		if (speed > params.maxSpeed) {
			const scale = params.maxSpeed / speed;
			node.vx *= scale;
			node.vy *= scale;
		}
		if (!xFixed) node.x += node.vx;
		if (!yFixed) node.y += node.vy;
	}
}

/** Synchronously run the simulation until `alpha` drops below `ALPHA_MIN`
 *  (or `maxIterations` is reached). The point is that the user never sees
 *  the wiggle — by the time we paint, nodes are already at rest. This is
 *  the conventional "pre-converge" step. Returns the final alpha so the
 *  caller knows whether to keep ticking (it almost always reached the
 *  floor). */
export function preConverge(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	params: LayoutParams,
	maxIterations = PRECONVERGE_MAX_ITERATIONS,
): number {
	let alpha = 1;
	let iterations = 0;
	while (alpha > ALPHA_MIN && iterations < maxIterations) {
		alpha = tickLayout(nodes, edges, params, alpha);
		iterations += 1;
	}
	coolDown(nodes);
	return alpha;
}
