import { describe, expect, it } from "vitest";
import { allShortestPaths, buildAdjacency, pathHops, shortestPath } from "./shortest-path";

const edges = (...pairs: [string, string][]) => pairs.map(([source, dest]) => ({ source, dest }));

describe("buildAdjacency", () => {
	it("is undirected and collapses parallels + self-loops", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["b", "a"], ["c", "c"]));
		expect([...(adj.get("a") ?? [])]).toEqual(["b"]);
		expect([...(adj.get("b") ?? [])]).toEqual(["a"]);
		expect(adj.has("c")).toBe(false);
	});
});

describe("shortestPath", () => {
	it("returns the single node for start === end", () => {
		expect(shortestPath(buildAdjacency(edges(["a", "b"])), "a", "a")).toEqual(["a"]);
	});

	it("walks a linear chain end to end", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"], ["c", "d"]));
		expect(shortestPath(adj, "a", "d")).toEqual(["a", "b", "c", "d"]);
	});

	it("picks the fewest-hops branch", () => {
		// a—b—c—d (3 hops) vs a—x—d (2 hops): the short way wins.
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"], ["c", "d"], ["a", "x"], ["x", "d"]));
		expect(shortestPath(adj, "a", "d")).toEqual(["a", "x", "d"]);
	});

	it("is symmetric (undirected)", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"]));
		expect(shortestPath(adj, "c", "a")).toEqual(["c", "b", "a"]);
	});

	it("returns null for disconnected nodes", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["c", "d"]));
		expect(shortestPath(adj, "a", "d")).toBeNull();
	});

	it("returns null when an endpoint has no edges at all", () => {
		const adj = buildAdjacency(edges(["a", "b"]));
		expect(shortestPath(adj, "a", "ghost")).toBeNull();
	});
});

const sorted = (set: Set<string> | null): string[] | null =>
	set === null ? null : [...set].sort();

describe("allShortestPaths", () => {
	it("returns just the start for start === end", () => {
		expect(sorted(allShortestPaths(buildAdjacency(edges(["a", "b"])), "a", "a"))).toEqual(["a"]);
	});

	it("collapses to the single route when only one shortest path exists", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"], ["c", "d"]));
		expect(sorted(allShortestPaths(adj, "a", "d"))).toEqual(["a", "b", "c", "d"]);
	});

	it("unions every node on two equally-short parallel routes", () => {
		// a—x—d and a—y—d are both 2 hops: both middles light up.
		const adj = buildAdjacency(edges(["a", "x"], ["x", "d"], ["a", "y"], ["y", "d"]));
		expect(sorted(allShortestPaths(adj, "a", "d"))).toEqual(["a", "d", "x", "y"]);
	});

	it("excludes nodes on a longer route when a shorter one exists", () => {
		// a—b—c—d (3 hops) loses to a—x—d (2 hops): b and c are NOT on a shortest path.
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"], ["c", "d"], ["a", "x"], ["x", "d"]));
		expect(sorted(allShortestPaths(adj, "a", "d"))).toEqual(["a", "d", "x"]);
	});

	it("is symmetric (undirected)", () => {
		const adj = buildAdjacency(edges(["a", "x"], ["x", "d"], ["a", "y"], ["y", "d"]));
		expect(sorted(allShortestPaths(adj, "d", "a"))).toEqual(["a", "d", "x", "y"]);
	});

	it("returns null for disconnected nodes", () => {
		expect(allShortestPaths(buildAdjacency(edges(["a", "b"], ["c", "d"])), "a", "d")).toBeNull();
	});

	it("returns null when an endpoint has no edges at all", () => {
		expect(allShortestPaths(buildAdjacency(edges(["a", "b"])), "a", "ghost")).toBeNull();
	});

	it("agrees with shortestPath's hop count on its node set", () => {
		const adj = buildAdjacency(edges(["a", "x"], ["x", "d"], ["a", "y"], ["y", "d"]));
		const set = allShortestPaths(adj, "a", "d");
		const one = shortestPath(adj, "a", "d");
		expect(set).not.toBeNull();
		expect(one).not.toBeNull();
		// every node of the single representative path is in the union
		for (const node of one ?? []) expect(set?.has(node)).toBe(true);
	});
});

describe("pathHops", () => {
	it("is one fewer than the node count for a real path", () => {
		expect(pathHops(["a", "b"])).toBe(1);
		expect(pathHops(["a", "x", "d"])).toBe(2);
		expect(pathHops(["a", "b", "c", "d"])).toBe(3);
	});

	it("is zero for a node to itself", () => {
		expect(pathHops(["a"])).toBe(0);
	});

	it("is zero (never negative) for an empty path", () => {
		expect(pathHops([])).toBe(0);
	});

	it("matches the length of the path shortestPath returns", () => {
		const adj = buildAdjacency(edges(["a", "b"], ["b", "c"], ["c", "d"]));
		const path = shortestPath(adj, "a", "d");
		expect(path).not.toBeNull();
		expect(pathHops(path ?? [])).toBe(3);
	});
});
