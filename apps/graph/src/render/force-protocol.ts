/**
 * Wire contract between the graph UI thread (`layout-driver.ts`) and the
 * force-layout worker (`force-worker.ts`), plus the pure marshalling
 * helpers that pack a `Map<id, LayoutNode>` + edge list into the flat
 * typed-array form the worker consumes and unpack a streamed positions
 * frame back into that Map.
 *
 * The helpers are deliberately transport-free so they unit-test without
 * a Worker. Position frames are `[x0,y0,x1,y1,…]` parallel to the `ids`
 * order captured at the last topology push (`epoch`); a stale-epoch
 * frame must be discarded by the consumer because the order no longer
 * matches.
 */

import type { EngineGraph } from "./force-engine";
import type { LayoutEdge, LayoutNode, LayoutParams } from "./force-layout";

export type WorkerInbound =
	| { type: "init"; params: LayoutParams }
	| { type: "reset"; epoch: number; params: LayoutParams; graph: EngineGraph }
	| {
			type: "fixed";
			epoch: number;
			items: ReadonlyArray<{ i: number; fx: number | null; fy: number | null }>;
	  }
	| { type: "reheat"; epoch: number; alpha: number }
	| { type: "params"; params: LayoutParams }
	| { type: "dispose" };

export type WorkerOutbound =
	| { type: "ready" }
	| { type: "frame"; epoch: number; alpha: number; pos: Float32Array };

/** Pack the live layout Map + edges into the worker's flat form. `ids`
 *  is captured in `Map` iteration order; the same order is assumed when
 *  a frame comes back. New nodes carry their seeded `x/y` so the worker
 *  starts them where the caller placed them. `reheat` is the *amount*
 *  to warm the sim (0..1) — a wholesale topology change passes 1, an
 *  incremental add during playback passes ~0.3 so the hubs already at
 *  rest don't get re-energised to full strength on every appended node
 *  (which made them visibly orbit each other). 0 leaves the sim cool. */
export function packGraph(
	nodes: Map<string, LayoutNode>,
	edges: readonly LayoutEdge[],
	reheat: number,
): { ids: string[]; graph: EngineGraph } {
	const ids: string[] = [];
	const idx = new Map<string, number>();
	for (const id of nodes.keys()) {
		idx.set(id, ids.length);
		ids.push(id);
	}
	const n = ids.length;
	const xs = new Float32Array(n);
	const ys = new Float32Array(n);
	const rs = new Float32Array(n);
	const fixed: { i: number; fx: number; fy: number }[] = [];
	for (let i = 0; i < n; i += 1) {
		const node = nodes.get(ids[i] as string) as LayoutNode;
		xs[i] = node.x;
		ys[i] = node.y;
		rs[i] = node.radius;
		if (node.fx !== null && node.fy !== null) fixed.push({ i, fx: node.fx, fy: node.fy });
	}
	const pairs: number[] = [];
	for (const e of edges) {
		const s = idx.get(e.source);
		const t = idx.get(e.target);
		if (s !== undefined && t !== undefined) pairs.push(s, t);
	}
	return { ids, graph: { ids, xs, ys, rs, edges: Int32Array.from(pairs), fixed, reheat } };
}

/** Copy a streamed positions frame back into the live Map. A node the
 *  UI thread is actively dragging / has pinned (`fx`/`fy` set) is left
 *  untouched — its coordinate is main-thread-authoritative so it tracks
 *  the cursor with zero round-trip lag while the worker still simulates
 *  its neighbours around it. Returns whether any position moved (paint
 *  gate). */
export function applyPositions(
	nodes: Map<string, LayoutNode>,
	ids: readonly string[],
	pos: Float32Array,
): boolean {
	let moved = false;
	for (let i = 0; i < ids.length; i += 1) {
		const node = nodes.get(ids[i] as string);
		if (!node || (node.fx !== null && node.fy !== null)) continue;
		const x = pos[i * 2] ?? node.x;
		const y = pos[i * 2 + 1] ?? node.y;
		if (x !== node.x || y !== node.y) moved = true;
		node.x = x;
		node.y = y;
	}
	return moved;
}
