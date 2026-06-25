/**
 * LayoutDriver — the graph UI thread's handle on the force simulation
 * (9.13.5: pixi + d3-force-in-worker).
 *
 * `app.ts` no longer ticks the simulation on the render loop. It owns a
 * `LayoutDriver`, pushes topology through `reset()`, forwards drag/pin
 * through `setFixed()/releaseFixed()`, and each animation frame calls
 * `pump()` — which copies the worker's most recent positions frame into
 * the live `Map<id, LayoutNode>` and reports whether the sim is still
 * warm (so the existing change-gated paint + idle behaviour is
 * unchanged). All the CPU-heavy `preConverge` + per-tick cooling now
 * happens in `force-worker.ts`, off the main thread.
 *
 * If a Worker can't be constructed (a sandbox that blocks it, a non-DOM
 * test, `vite serve` quirks) the driver transparently falls back to a
 * synchronous in-process `ForceEngine` — behaviour-identical to the
 * pre-9.13.5 path — so the app never hard-fails on the simulation.
 */

import { type EngineGraph, ForceEngine } from "./force-engine";
import { ALPHA_MIN, type LayoutEdge, type LayoutNode, type LayoutParams } from "./force-layout";
import { type WorkerOutbound, applyPositions, packGraph } from "./force-protocol";
// `?worker&inline`: the shell loads apps over `file://` (launcher.ts), and a
// `new Worker(new URL('./w', import.meta.url), {type:'module'})` can't be
// constructed from a `file://` (opaque-origin) document — it throws and we'd
// silently fall back to the slow on-thread engine. Vite's inline worker
// bundles it as a Blob URL, which *does* construct under `file://`, so the
// simulation actually runs off-thread in production.
import GraphForceWorker from "./force-worker?worker&inline";

export type LayoutDriverOptions = {
	/** Force the synchronous fallback (tests / explicit opt-out). */
	forceSync?: boolean;
	/** Inject the Worker (tests — stub a dead/slow worker). Defaults to the
	 *  Vite inline-bundled `GraphForceWorker`. */
	workerFactory?: () => Worker;
};

/** If the worker hasn't said `ready` (or sent a frame) within this long,
 *  treat it as dead and fall back to the on-thread engine. A Blob worker
 *  that silently fails to run under `file://` throws no error, so this
 *  timeout is the only thing that catches it — without it the driver
 *  would repaint every frame forever waiting on a corpse. */
const WORKER_READY_TIMEOUT_MS = 1500;

/** Per-frame simulation time budget for the on-thread engine. Kept well
 *  under a 16 ms frame so a paint still fits — convergence spreads over a
 *  few frames instead of blocking in one synchronous `preConverge`. */
const SIM_BUDGET_MS = 4;

/** True when the document was loaded over `file://` (how the shell loads
 *  app bundles today — launcher.ts). A Blob/module Worker is unreliable
 *  from an opaque `file://` origin (constructs but may never run, with no
 *  error), so we skip it entirely there and use the time-sliced on-thread
 *  engine — which never blocks the thread regardless. The worker path
 *  stays for non-`file://` origins (future `brainstorm://` serving) and
 *  for injected test workers. */
function fileOriginUnreliableForWorkers(): boolean {
	return typeof location !== "undefined" && location.protocol === "file:";
}

export class LayoutDriver {
	private params: LayoutParams;
	private worker: Worker | null = null;
	private engine: ForceEngine | null = null;
	private ids: string[] = [];
	private idIndex = new Map<string, number>();
	private epoch = 0;
	private latest: { epoch: number; alpha: number; pos: Float32Array } | null = null;
	private healthy = false;
	private disposed = false;
	private lastGraph: EngineGraph | null = null;
	private readyTimer: ReturnType<typeof setTimeout> | null = null;
	/** Reused across frames for the on-thread engine's position read-out so a
	 *  warm sim (i.e. the whole of every drag) doesn't allocate a fresh
	 *  `Float32Array(2N)` every frame. Resized only when the node count
	 *  changes (in `reset`). */
	private posBuffer = new Float32Array(0);

	constructor(params: LayoutParams, options: LayoutDriverOptions = {}) {
		this.params = params;
		const skipWorker = !options.workerFactory && fileOriginUnreliableForWorkers();
		if (!options.forceSync && !skipWorker) {
			try {
				const make = options.workerFactory ?? (() => new GraphForceWorker());
				if (options.workerFactory || typeof Worker !== "undefined") {
					this.worker = make();
					this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
						// Any inbound message proves the worker is alive.
						this.markHealthy();
						const m = ev.data;
						if (m.type === "frame") this.latest = { epoch: m.epoch, alpha: m.alpha, pos: m.pos };
					};
					this.worker.onerror = () => this.degradeToSync();
					this.worker.postMessage({ type: "init", params });
					this.readyTimer = setTimeout(() => {
						if (!this.healthy) this.degradeToSync();
					}, WORKER_READY_TIMEOUT_MS);
				}
			} catch {
				this.worker = null;
			}
		}
		if (!this.worker) this.engine = new ForceEngine(params);
	}

	/** Whether the simulation is still moving (drives paint gating). */
	get warm(): boolean {
		if (this.engine) return this.engine.warm;
		return this.latest ? this.latest.alpha > ALPHA_MIN : false;
	}

	private markHealthy(): void {
		this.healthy = true;
		if (this.readyTimer !== null) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
	}

	/** Tear the worker down and continue on the in-process engine. Replays
	 *  the last pushed topology so `pump` keeps working seamlessly — the
	 *  next frame paints the engine's (pre-converged) layout. */
	private degradeToSync(): void {
		if (this.engine || this.disposed) return;
		if (this.readyTimer !== null) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		try {
			this.worker?.terminate();
		} catch {
			/* already gone */
		}
		this.worker = null;
		this.latest = null;
		this.engine = new ForceEngine(this.params);
		if (this.lastGraph) this.engine.reset(this.lastGraph);
	}

	setParams(params: LayoutParams): void {
		this.params = params;
		if (this.worker) this.worker.postMessage({ type: "params", params });
		else this.engine?.setParams(params);
	}

	/** Push a new topology. Existing ids keep their position; `reheat` is
	 *  the *amount* to warm the sim (0..1) — 1 for a wholesale change,
	 *  ~0.3 for an incremental playback add, 0 to leave it cool. */
	reset(nodes: Map<string, LayoutNode>, edges: readonly LayoutEdge[], reheat: number): void {
		const { ids, graph } = packGraph(nodes, edges, reheat);
		this.ids = ids;
		this.idIndex = new Map(ids.map((id, i) => [id, i] as const));
		if (this.posBuffer.length < ids.length * 2) this.posBuffer = new Float32Array(ids.length * 2);
		this.epoch += 1;
		this.latest = null;
		this.lastGraph = graph; // kept so a later degrade can replay it
		if (this.worker) {
			// NOT transferred: a degrade after this needs `lastGraph`'s
			// buffers intact to replay into the engine, and transfer would
			// detach them. The arrays are O(N) and reset is debounced, so
			// the structured-clone copy is negligible.
			this.worker.postMessage({ type: "reset", epoch: this.epoch, params: this.params, graph });
		} else if (this.engine) {
			// No synchronous pre-converge — `reset` only re-warms; `pump`
			// time-slices the convergence so the thread never blocks.
			this.engine.reset(graph);
			applyPositions(nodes, this.ids, this.engine.readPositions(this.posBuffer));
		}
	}

	/** Copy the freshest simulated positions into `nodes`. Returns
	 *  whether anything moved (paint gate). Safe to call every frame. */
	pump(nodes: Map<string, LayoutNode>): boolean {
		if (this.engine) {
			// Budgeted: advance the sim for at most SIM_BUDGET_MS this frame
			// so a big graph converges over a few frames instead of one
			// thread-wedging synchronous pass.
			const warm = this.engine.stepFor(SIM_BUDGET_MS);
			const moved = applyPositions(nodes, this.ids, this.engine.readPositions(this.posBuffer));
			return warm || moved;
		}
		// No current frame yet (worker still starting / between epochs):
		// report "nothing to paint from the sim". A dead worker therefore
		// can NOT pin the loop at 100% — and the reconcile that triggered
		// the reset already set `forceRepaint`, so the settled layout still
		// paints once the first real frame lands (or after degrade).
		const frame = this.latest;
		if (!frame || frame.epoch !== this.epoch) return false;
		const moved = applyPositions(nodes, this.ids, frame.pos);
		return moved || frame.alpha > ALPHA_MIN;
	}

	private fixed(id: string, fx: number | null, fy: number | null): void {
		const i = this.idIndex.get(id);
		if (i === undefined) return;
		if (this.worker) {
			this.worker.postMessage({ type: "fixed", epoch: this.epoch, items: [{ i, fx, fy }] });
		} else {
			this.engine?.setFixed([{ i, fx, fy }]);
		}
	}

	setFixed(id: string, fx: number, fy: number): void {
		this.fixed(id, fx, fy);
	}

	releaseFixed(id: string): void {
		this.fixed(id, null, null);
	}

	reheat(alpha: number): void {
		if (this.worker) this.worker.postMessage({ type: "reheat", epoch: this.epoch, alpha });
		else this.engine?.reheat(alpha);
	}

	dispose(): void {
		this.disposed = true;
		if (this.readyTimer !== null) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		if (this.worker) {
			try {
				this.worker.postMessage({ type: "dispose" });
				this.worker.terminate();
			} catch {
				/* already gone */
			}
			this.worker = null;
		}
		this.engine = null;
	}
}
