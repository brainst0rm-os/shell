import { afterEach, describe, expect, it, vi } from "vitest";
import { ForceEngine } from "./force-engine";
import { DEFAULT_LAYOUT_PARAMS, type LayoutEdge, type LayoutNode } from "./force-layout";
import { applyPositions, packGraph } from "./force-protocol";
import { LayoutDriver } from "./layout-driver";

function node(id: string, x: number, y: number, over: Partial<LayoutNode> = {}): LayoutNode {
	return { id, x, y, vx: 0, vy: 0, pinned: false, fx: null, fy: null, radius: 6, ...over };
}

function mapOf(...nodes: LayoutNode[]): Map<string, LayoutNode> {
	return new Map(nodes.map((n) => [n.id, n] as const));
}

describe("force-protocol packGraph", () => {
	it("packs ids in Map order with parallel x/y/radius arrays", () => {
		const nodes = mapOf(node("a", 1, 2, { radius: 9 }), node("b", 3, 4));
		const { ids, graph } = packGraph(nodes, [], 0);
		expect(ids).toEqual(["a", "b"]);
		expect(Array.from(graph.xs)).toEqual([1, 3]);
		expect(Array.from(graph.ys)).toEqual([2, 4]);
		expect(Array.from(graph.rs)).toEqual([9, 6]);
		expect(graph.reheat).toBe(0);
	});

	it("extracts fixed (fx/fy) nodes and indexes edges, dropping dangling ones", () => {
		const nodes = mapOf(node("a", 0, 0, { fx: 5, fy: 6 }), node("b", 1, 1));
		const edges: LayoutEdge[] = [
			{ source: "a", target: "b" },
			{ source: "a", target: "ghost" },
		];
		const { graph } = packGraph(nodes, edges, 1);
		expect(graph.fixed).toEqual([{ i: 0, fx: 5, fy: 6 }]);
		expect(Array.from(graph.edges)).toEqual([0, 1]); // a→b only; a→ghost dropped
		expect(graph.reheat).toBe(1);
	});
});

describe("force-protocol applyPositions", () => {
	it("writes streamed coords and reports movement", () => {
		const nodes = mapOf(node("a", 0, 0), node("b", 0, 0));
		const moved = applyPositions(nodes, ["a", "b"], Float32Array.from([10, 20, 30, 40]));
		expect(moved).toBe(true);
		expect(nodes.get("a")).toMatchObject({ x: 10, y: 20 });
		expect(nodes.get("b")).toMatchObject({ x: 30, y: 40 });
	});

	it("never overwrites a pinned/dragged (fx+fy) node", () => {
		const nodes = mapOf(node("a", 7, 7, { fx: 7, fy: 7 }));
		const moved = applyPositions(nodes, ["a"], Float32Array.from([999, 999]));
		expect(moved).toBe(false);
		expect(nodes.get("a")).toMatchObject({ x: 7, y: 7 });
	});
});

describe("ForceEngine", () => {
	it("a reheated reset does NOT block (no synchronous pre-converge); stepFor time-slices to rest", () => {
		const engine = new ForceEngine(DEFAULT_LAYOUT_PARAMS);
		const nodes = mapOf(node("a", 0, 0), node("b", 300, 0), node("c", 0, 300));
		const { graph } = packGraph(nodes, [{ source: "a", target: "b" }], 1);
		engine.reset(graph);
		expect(engine.nodeCount).toBe(3);
		const pos = engine.readPositions();
		expect(pos.length).toBe(6);
		expect(pos.every((v) => Number.isFinite(v))).toBe(true);
		// Regression guard: reset must leave the sim WARM (work deferred to
		// time-sliced steps), never pre-converged synchronously — that
		// synchronous pass was the multi-second main-thread freeze.
		expect(engine.warm).toBe(true);
		// A zero-budget slice still does ≥1 tick (progress guaranteed) but
		// does NOT fully converge — proving it's incremental, not blocking.
		expect(engine.stepFor(0)).toBe(true);
		expect(engine.warm).toBe(true);
		// A generous budget converges it to rest within bounded wall time.
		let guard = 0;
		while (engine.stepFor(50) && guard < 200) guard += 1;
		expect(engine.warm).toBe(false);
		expect(guard).toBeLessThan(200);
	});

	it("reheat re-warms a cooled engine; setFixed pins a node to fx/fy", () => {
		const engine = new ForceEngine(DEFAULT_LAYOUT_PARAMS);
		const { graph } = packGraph(mapOf(node("a", 0, 0), node("b", 50, 0)), [], 0);
		engine.reset(graph);
		expect(engine.warm).toBe(false);
		engine.reheat(0.5);
		expect(engine.warm).toBe(true);
		engine.setFixed([{ i: 0, fx: 123, fy: 456 }]);
		for (let i = 0; i < 5; i += 1) engine.step();
		const pos = engine.readPositions();
		expect(pos[0]).toBeCloseTo(123, 3);
		expect(pos[1]).toBeCloseTo(456, 3);
	});
});

describe("LayoutDriver (synchronous fallback)", () => {
	it("reset → pump drives positions in the live map; cools to settled", () => {
		const driver = new LayoutDriver(DEFAULT_LAYOUT_PARAMS, { forceSync: true });
		const nodes = mapOf(node("a", 0, 0), node("b", 400, 0), node("c", 0, 400));
		driver.reset(nodes, [{ source: "a", target: "b" }], 1);
		// The sync fallback mirrors the pre-converged layout straight back.
		expect([...nodes.values()].every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
		let guard = 0;
		while (driver.pump(nodes) && guard < 200) guard += 1;
		expect(guard).toBeLessThan(200); // it actually settles
		driver.dispose();
	});

	it("a dragged (fixed) node stays under the cursor while neighbours move", () => {
		const driver = new LayoutDriver(DEFAULT_LAYOUT_PARAMS, { forceSync: true });
		const a = node("a", 10, 10);
		const b = node("b", 200, 0);
		const nodes = mapOf(a, b);
		driver.reset(nodes, [{ source: "a", target: "b" }], 1);
		// Mimic the drag handler: it sets fx/fy AND the paint coord x/y,
		// then forwards the pin to the sim.
		a.fx = 42;
		a.fy = 99;
		a.x = 42;
		a.y = 99;
		driver.setFixed("a", 42, 99);
		driver.reheat(0.4);
		for (let i = 0; i < 10; i += 1) driver.pump(nodes);
		// `applyPositions` must leave the pinned node exactly where the
		// drag handler placed it, even as the worker moves its neighbour.
		expect(nodes.get("a")).toMatchObject({ x: 42, y: 99 });
		expect(nodes.get("b")?.x).not.toBe(200);
		driver.dispose();
	});
});

/** Minimal Worker stub. `behaviour` decides what it echoes back so we can
 *  simulate a healthy worker, or one that constructs but never responds
 *  (the `file://` Blob-worker corpse the readiness timeout must catch). */
class StubWorker {
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	posted: unknown[] = [];
	constructor(private behaviour: "dead" | "healthy") {}
	postMessage(msg: { type: string; epoch?: number }): void {
		this.posted.push(msg);
		if (this.behaviour === "dead") return;
		if (msg.type === "init") this.onmessage?.({ data: { type: "ready" } } as MessageEvent);
		if (msg.type === "reset") {
			const pos = Float32Array.from([11, 22, 33, 44]);
			this.onmessage?.({
				data: { type: "frame", epoch: msg.epoch, alpha: 0, pos },
			} as MessageEvent);
		}
	}
	terminate(): void {}
}

describe("LayoutDriver worker liveness", () => {
	afterEach(() => vi.useRealTimers());

	it("a constructed-but-silent worker can NOT pin the loop, then degrades to the engine", () => {
		vi.useFakeTimers();
		const dead = new StubWorker("dead");
		const driver = new LayoutDriver(DEFAULT_LAYOUT_PARAMS, {
			workerFactory: () => dead as unknown as Worker,
		});
		const nodes = mapOf(node("a", 0, 0), node("b", 250, 0), node("c", 0, 250));
		driver.reset(nodes, [{ source: "a", target: "b" }], 1);
		// Critical regression guard: with no frame from the worker, pump must
		// return false every call — never the old "warm forever" that made
		// the render loop repaint every frame indefinitely.
		for (let i = 0; i < 5; i += 1) expect(driver.pump(nodes)).toBe(false);
		// Readiness timeout fires → degrade to the in-process engine, which
		// replays the last topology (pre-converged) so pump now drives it.
		vi.advanceTimersByTime(2000);
		driver.pump(nodes);
		expect([...nodes.values()].every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
		let guard = 0;
		while (driver.pump(nodes) && guard < 300) guard += 1;
		expect(guard).toBeLessThan(300); // settles, not a perpetual repaint
		driver.dispose();
	});

	it("a responsive worker stays the source of truth (no degrade) and streams frames", () => {
		vi.useFakeTimers();
		const driver = new LayoutDriver(DEFAULT_LAYOUT_PARAMS, {
			workerFactory: () => new StubWorker("healthy") as unknown as Worker,
		});
		const a = node("a", 0, 0);
		const nodes = mapOf(a, node("b", 9, 9));
		driver.reset(nodes, [], 1);
		driver.pump(nodes);
		// Positions came from the worker's streamed frame, not the engine.
		expect(nodes.get("a")).toMatchObject({ x: 11, y: 22 });
		expect(nodes.get("b")).toMatchObject({ x: 33, y: 44 });
		// Timer elapsing must not switch to the engine — the worker is healthy.
		vi.advanceTimersByTime(5000);
		a.x = 0;
		driver.pump(nodes);
		expect(nodes.get("a")?.x).toBe(11); // still worker-driven
		driver.dispose();
	});
});
