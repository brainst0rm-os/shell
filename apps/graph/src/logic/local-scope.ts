/**
 * Local-graph scope helper — given an in-memory graph and a root entity
 * id, return the sub-graph reachable within `depth` hops of the root,
 * optionally constrained to a traversal direction.
 *
 * Pure: no DOM, no state. The Graph app calls this in `reconcileScene`
 * when `state.localRootId` is set, swapping the scene's underlying db
 * for the local subgraph. The renderer / matcher / scene builder are
 * unchanged — they read the smaller `InMemoryGraph` and produce a
 * smaller `Scene`, so every existing zoom / drag / pattern path keeps
 * working unchanged in local mode.
 *
 * **Semantics (9.13.7).** `depth` controls *reachability*: BFS from the
 * root, expanding only along edges the `direction` permits. `direction`
 * constrains which nodes are reachable, NOT which edges are hidden among
 * them — the returned `links` are *every* non-deleted link whose both
 * endpoints landed in scope, so the user sees the true connectivity of
 * what's shown (triangles, back-references) rather than only the BFS
 * tree. `depth = 1, direction = Both` reproduces the original 1-hop
 * "this entity and who it touches" behaviour exactly.
 */

import type { InMemoryGraph, LinkRow } from "./in-memory-graph";

/** Which edges BFS may traverse, relative to the frontier node:
 *  `Out` follows source→dest, `In` follows dest→source, `Both` either.
 *  Wire/persist values are the enum's string values. */
export enum LocalDirection {
	In = "in",
	Out = "out",
	Both = "both",
}

/** Hop ceiling for the local view. Matches the 9.13.7 design (depth
 *  slider 1..10) — beyond ~10 hops a "local" view is the whole graph on
 *  any real vault, so the slider (and this clamp) cap there. */
export const MAX_LOCAL_DEPTH = 10;
export const MIN_LOCAL_DEPTH = 1;
export const DEFAULT_LOCAL_DEPTH = 1;
export const DEFAULT_LOCAL_DIRECTION = LocalDirection.Both;

export type LocalScopeOptions = {
	/** Hops from the root. Clamped to `[MIN_LOCAL_DEPTH, MAX_LOCAL_DEPTH]`
	 *  and floored — a non-finite / fractional value can't crash BFS. */
	depth?: number;
	/** Traversal direction. Defaults to `Both`. */
	direction?: LocalDirection;
};

/** Clamp + integer-floor a requested depth so a corrupt persisted value
 *  (NaN, 0, 99, 2.5) can never produce an unbounded or zero-hop walk. */
export function clampLocalDepth(depth: number): number {
	if (!Number.isFinite(depth)) return DEFAULT_LOCAL_DEPTH;
	return Math.max(MIN_LOCAL_DEPTH, Math.min(MAX_LOCAL_DEPTH, Math.floor(depth)));
}

/**
 * Build the sub-graph within `depth` hops of `rootId`. Returns `null`
 * when the root doesn't exist (caller falls back to the full graph).
 * The root is always included even with zero incident edges so the user
 * sees "this node has no connections" rather than an empty canvas.
 */
export function localScope(
	db: InMemoryGraph,
	rootId: string,
	options: LocalScopeOptions = {},
): InMemoryGraph | null {
	if (!db.entities.some((e) => e.id === rootId)) return null;

	const depth = clampLocalDepth(options.depth ?? DEFAULT_LOCAL_DEPTH);
	const direction = options.direction ?? DEFAULT_LOCAL_DIRECTION;
	const followOut = direction === LocalDirection.Out || direction === LocalDirection.Both;
	const followIn = direction === LocalDirection.In || direction === LocalDirection.Both;

	// Adjacency built once from the non-deleted links, keyed by the
	// frontier node and filtered to the permitted direction(s). O(links).
	const liveLinks = db.links.filter((l) => l.deletedAt === null);
	const reachableFrom = new Map<string, string[]>();
	const push = (from: string, to: string) => {
		const list = reachableFrom.get(from);
		if (list) list.push(to);
		else reachableFrom.set(from, [to]);
	};
	for (const l of liveLinks) {
		if (followOut) push(l.sourceEntityId, l.destEntityId);
		if (followIn) push(l.destEntityId, l.sourceEntityId);
	}

	// Level-synchronous BFS to `depth` hops.
	const inScope = new Set<string>([rootId]);
	let frontier: string[] = [rootId];
	for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
		const next: string[] = [];
		for (const node of frontier) {
			for (const neighbour of reachableFrom.get(node) ?? []) {
				if (inScope.has(neighbour)) continue;
				inScope.add(neighbour);
				next.push(neighbour);
			}
		}
		frontier = next;
	}

	const entities = db.entities.filter((e) => inScope.has(e.id));
	// Display every live link between two in-scope nodes — direction only
	// gated *reachability*, not what's drawn among the reached set.
	const links: LinkRow[] = liveLinks.filter(
		(l) => inScope.has(l.sourceEntityId) && inScope.has(l.destEntityId),
	);
	return { entities, links };
}
