import { describe, expect, it } from "vitest";

import type { InMemoryGraph } from "./in-memory-graph";
import {
	DEFAULT_LOCAL_DEPTH,
	LocalDirection,
	MAX_LOCAL_DEPTH,
	clampLocalDepth,
	localScope,
} from "./local-scope";

/** Linear chain a→b→c→d→e (all out-edges, no deletions). Lets a single
 *  graph exercise depth + direction without per-test fixtures. */
function chain(): InMemoryGraph {
	const ids = ["a", "b", "c", "d", "e"];
	return {
		entities: ids.map((id) => ({
			id,
			type: "T",
			properties: {},
			createdAt: 1,
			updatedAt: 1,
			deletedAt: null,
		})),
		links: [
			["a", "b"],
			["b", "c"],
			["c", "d"],
			["d", "e"],
		].map(([s, d]) => ({
			id: `${s}${d}`,
			sourceEntityId: s as string,
			destEntityId: d as string,
			linkType: "x",
			createdAt: 1,
			deletedAt: null,
		})),
	};
}

function idset(g: InMemoryGraph | null): Set<string> {
	return new Set(g?.entities.map((e) => e.id));
}

function makeGraph(): InMemoryGraph {
	return {
		entities: [
			{ id: "a", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			{ id: "b", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			{ id: "c", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			{ id: "d", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			{ id: "e", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
		],
		links: [
			{
				id: "ab",
				sourceEntityId: "a",
				destEntityId: "b",
				linkType: "x",
				createdAt: 1,
				deletedAt: null,
			},
			{
				id: "ac",
				sourceEntityId: "a",
				destEntityId: "c",
				linkType: "x",
				createdAt: 1,
				deletedAt: null,
			},
			{
				id: "bd",
				sourceEntityId: "b",
				destEntityId: "d",
				linkType: "x",
				createdAt: 1,
				deletedAt: null,
			},
			{
				id: "de",
				sourceEntityId: "d",
				destEntityId: "e",
				linkType: "x",
				createdAt: 1,
				deletedAt: null,
			},
			{
				id: "ae-del",
				sourceEntityId: "a",
				destEntityId: "e",
				linkType: "x",
				createdAt: 1,
				deletedAt: 5,
			},
		],
	};
}

describe("localScope", () => {
	it("includes root + 1-hop neighbours and their connecting links", () => {
		const out = localScope(makeGraph(), "a");
		expect(out).not.toBeNull();
		const ids = new Set(out?.entities.map((e) => e.id));
		// a (root), b + c (direct neighbours via ab, ac). d and e are 2 hops away.
		expect(ids).toEqual(new Set(["a", "b", "c"]));
		expect(out?.links.map((l) => l.id).sort()).toEqual(["ab", "ac"]);
	});

	it("walks inbound edges too (root as destination)", () => {
		const db: InMemoryGraph = {
			entities: [
				{ id: "x", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
				{ id: "y", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			],
			links: [
				{
					id: "yx",
					sourceEntityId: "y",
					destEntityId: "x",
					linkType: "x",
					createdAt: 1,
					deletedAt: null,
				},
			],
		};
		const out = localScope(db, "x");
		expect(out?.entities.map((e) => e.id).sort()).toEqual(["x", "y"]);
		expect(out?.links.map((l) => l.id)).toEqual(["yx"]);
	});

	it("returns the lone root when there are no incident links", () => {
		const out = localScope(makeGraph(), "e");
		// e's only link (de) doesn't touch the root — wait, it does. Use an actual orphan:
		const db: InMemoryGraph = {
			entities: [
				{ id: "orphan", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
				{ id: "other", type: "T", properties: {}, createdAt: 1, updatedAt: 1, deletedAt: null },
			],
			links: [],
		};
		const result = localScope(db, "orphan");
		expect(result?.entities).toEqual([expect.objectContaining({ id: "orphan" })]);
		expect(result?.links).toEqual([]);
		expect(out).not.toBeNull();
	});

	it("ignores deleted edges", () => {
		// `ae-del` is deleted; e should NOT come back as a neighbour of a.
		const out = localScope(makeGraph(), "a");
		const ids = new Set(out?.entities.map((e) => e.id));
		expect(ids.has("e")).toBe(false);
	});

	it("returns null when the root doesn't exist", () => {
		expect(localScope(makeGraph(), "nope")).toBeNull();
	});

	it("default options reproduce the legacy 1-hop / both-direction view", () => {
		const explicit = localScope(makeGraph(), "a", {
			depth: DEFAULT_LOCAL_DEPTH,
			direction: LocalDirection.Both,
		});
		const implicit = localScope(makeGraph(), "a");
		expect(idset(implicit)).toEqual(idset(explicit));
		expect(idset(implicit)).toEqual(new Set(["a", "b", "c"]));
	});
});

describe("localScope — depth (9.13.7)", () => {
	it("expands one level per hop along the chain", () => {
		expect(idset(localScope(chain(), "a", { depth: 1 }))).toEqual(new Set(["a", "b"]));
		expect(idset(localScope(chain(), "a", { depth: 2 }))).toEqual(new Set(["a", "b", "c"]));
		expect(idset(localScope(chain(), "a", { depth: 3 }))).toEqual(new Set(["a", "b", "c", "d"]));
	});

	it("reaches the whole connected component at MAX depth", () => {
		expect(idset(localScope(chain(), "a", { depth: MAX_LOCAL_DEPTH }))).toEqual(
			new Set(["a", "b", "c", "d", "e"]),
		);
	});

	it("includes every live link among the in-scope nodes, not just the BFS tree", () => {
		// a→b, a→c, b→c — depth-1 from a reaches {a,b,c}; the b→c edge is
		// not a BFS-tree edge but IS shown (induced-subgraph semantics).
		const triangle: InMemoryGraph = {
			entities: ["a", "b", "c"].map((id) => ({
				id,
				type: "T",
				properties: {},
				createdAt: 1,
				updatedAt: 1,
				deletedAt: null,
			})),
			links: [
				["ab", "a", "b"],
				["ac", "a", "c"],
				["bc", "b", "c"],
			].map(([id, s, d]) => ({
				id: id as string,
				sourceEntityId: s as string,
				destEntityId: d as string,
				linkType: "x",
				createdAt: 1,
				deletedAt: null,
			})),
		};
		const out = localScope(triangle, "a", { depth: 1 });
		expect(out?.links.map((l) => l.id).sort()).toEqual(["ab", "ac", "bc"]);
	});
});

describe("localScope — direction (9.13.7)", () => {
	it("Out follows only source→dest", () => {
		expect(
			idset(localScope(chain(), "a", { depth: MAX_LOCAL_DEPTH, direction: LocalDirection.Out })),
		).toEqual(new Set(["a", "b", "c", "d", "e"]));
		// Nothing points *into* a, so an Out walk from the chain tail is lonely.
		expect(
			idset(localScope(chain(), "e", { depth: MAX_LOCAL_DEPTH, direction: LocalDirection.Out })),
		).toEqual(new Set(["e"]));
	});

	it("In follows only dest→source", () => {
		expect(
			idset(localScope(chain(), "e", { depth: MAX_LOCAL_DEPTH, direction: LocalDirection.In })),
		).toEqual(new Set(["a", "b", "c", "d", "e"]));
		expect(
			idset(localScope(chain(), "a", { depth: MAX_LOCAL_DEPTH, direction: LocalDirection.In })),
		).toEqual(new Set(["a"]));
	});

	it("Both is the union of In and Out reachability", () => {
		expect(idset(localScope(chain(), "c", { depth: 1, direction: LocalDirection.Both }))).toEqual(
			new Set(["b", "c", "d"]),
		);
	});
});

describe("clampLocalDepth", () => {
	it("floors and clamps into [1, MAX]", () => {
		expect(clampLocalDepth(0)).toBe(1);
		expect(clampLocalDepth(-3)).toBe(1);
		expect(clampLocalDepth(2.9)).toBe(2);
		expect(clampLocalDepth(MAX_LOCAL_DEPTH + 50)).toBe(MAX_LOCAL_DEPTH);
		expect(clampLocalDepth(5)).toBe(5);
	});

	it("falls back to the default on a non-finite value", () => {
		expect(clampLocalDepth(Number.NaN)).toBe(DEFAULT_LOCAL_DEPTH);
		expect(clampLocalDepth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LOCAL_DEPTH);
	});

	it("a corrupt persisted depth can never crash or unbound BFS", () => {
		const g = chain();
		for (const bad of [Number.NaN, 0, -1, 999, 2.5]) {
			const out = localScope(g, "a", { depth: bad });
			expect(out).not.toBeNull();
			expect((out?.entities.length ?? 0) <= g.entities.length).toBe(true);
		}
	});
});
