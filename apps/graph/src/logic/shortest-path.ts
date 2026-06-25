/**
 * Shortest-path over the live graph (9.13 Path view) — pure, render-free.
 *
 * The graph is treated as **undirected** for pathfinding: a relation connects
 * its two entities regardless of which way the edge was authored, which is
 * what "how are these two things connected?" means to the user. BFS gives the
 * fewest-hops path (every edge is weight 1); ties resolve to the first path
 * BFS reaches, which is stable for a given adjacency insertion order.
 */

export type Adjacency = ReadonlyMap<string, ReadonlySet<string>>;

/** Build an undirected adjacency map from the scene's edges. Self-loops are
 *  dropped (they can't shorten a path); parallel edges collapse (a Set). */
export function buildAdjacency(
	edges: readonly { source: string; dest: string }[],
): Map<string, Set<string>> {
	const adjacency = new Map<string, Set<string>>();
	const link = (a: string, b: string): void => {
		let set = adjacency.get(a);
		if (!set) {
			set = new Set<string>();
			adjacency.set(a, set);
		}
		set.add(b);
	};
	for (const { source, dest } of edges) {
		if (source === dest) continue;
		link(source, dest);
		link(dest, source);
	}
	return adjacency;
}

/**
 * The fewest-hops node-id path from `start` to `end` inclusive, or null when
 * they're disconnected. A node to itself is the single-element path `[start]`.
 * Returns null if either endpoint has no incident edges (absent from the map).
 */
export function shortestPath(adjacency: Adjacency, start: string, end: string): string[] | null {
	if (start === end) return [start];
	if (!adjacency.has(start) || !adjacency.has(end)) return null;

	const visited = new Set<string>([start]);
	const previous = new Map<string, string>();
	const queue: string[] = [start];
	let head = 0;

	while (head < queue.length) {
		const current = queue[head];
		head += 1;
		if (current === undefined) break;
		for (const next of adjacency.get(current) ?? []) {
			if (visited.has(next)) continue;
			visited.add(next);
			previous.set(next, current);
			if (next === end) return reconstruct(previous, start, end);
			queue.push(next);
		}
	}
	return null;
}

/**
 * The number of hops (edges traversed) a node path represents — one fewer than
 * its node count. An empty path or a single-node path (a node to itself) is
 * zero hops. Lets the Path-view status pill report "Connected in N hops"
 * instead of a bare "highlighted", so the user reads the distance at a glance.
 */
export function pathHops(path: readonly string[]): number {
	return path.length > 0 ? path.length - 1 : 0;
}

/** BFS hop-distance from `source` to every node it can reach (the source is
 *  distance 0). Nodes absent from the returned map are unreachable. */
function distancesFrom(adjacency: Adjacency, source: string): Map<string, number> {
	const distance = new Map<string, number>([[source, 0]]);
	const queue: string[] = [source];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head];
		head += 1;
		if (current === undefined) break;
		const here = distance.get(current);
		if (here === undefined) continue;
		for (const next of adjacency.get(current) ?? []) {
			if (distance.has(next)) continue;
			distance.set(next, here + 1);
			queue.push(next);
		}
	}
	return distance;
}

/**
 * The set of every node that lies on **some** fewest-hops path between `start`
 * and `end` (the multi-edge case: when two or more equally-short routes exist,
 * the Path view highlights all of them, not just the one BFS happens to reach
 * first). A node `n` is on a shortest path iff
 * `dist(start, n) + dist(n, end) === dist(start, end)`. Returns null when the
 * two are disconnected; a node to itself is the single-element set `{start}`.
 * Endpoints absent from the graph (no incident edges) yield null.
 */
export function allShortestPaths(
	adjacency: Adjacency,
	start: string,
	end: string,
): Set<string> | null {
	if (start === end) return new Set([start]);
	if (!adjacency.has(start) || !adjacency.has(end)) return null;

	const fromStart = distancesFrom(adjacency, start);
	const total = fromStart.get(end);
	if (total === undefined) return null;

	const fromEnd = distancesFrom(adjacency, end);
	const onPath = new Set<string>();
	for (const [node, distStart] of fromStart) {
		const distEnd = fromEnd.get(node);
		if (distEnd !== undefined && distStart + distEnd === total) onPath.add(node);
	}
	return onPath;
}

function reconstruct(previous: ReadonlyMap<string, string>, start: string, end: string): string[] {
	const path: string[] = [end];
	let cursor = end;
	while (cursor !== start) {
		const prev = previous.get(cursor);
		if (prev === undefined) break;
		path.push(prev);
		cursor = prev;
	}
	path.reverse();
	return path;
}
