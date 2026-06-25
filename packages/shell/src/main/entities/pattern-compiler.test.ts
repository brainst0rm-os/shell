import { describe, expect, it } from "vitest";
import { EdgeDirection, EdgeMatch, type GraphPattern, SubjectKind } from "./pattern";
import { MULTI_HOP_CTE_ROW_LIMIT, compilePattern } from "./pattern-compiler";

function subject(types: string[], where: GraphPattern["subjects"][string]["where"] = null) {
	return {
		kind: SubjectKind.Entity as const,
		types,
		where,
		displayName: types[0] ?? "Any",
	};
}

/** Replace the edge at `index` with the result of `mutator(edge)`. Throws
 *  loudly if the fixture is missing an edge there — keeps tests readable
 *  without the non-null `!` idiom Biome forbids. */
function tweakEdge(
	pattern: GraphPattern,
	index: number,
	mutator: (edge: GraphPattern["edges"][number]) => GraphPattern["edges"][number],
): GraphPattern {
	const edge = pattern.edges[index];
	if (!edge) throw new Error(`test fixture missing edge at index ${index}`);
	const next = [...pattern.edges];
	next[index] = mutator(edge);
	return { ...pattern, edges: next };
}

function canonicalExample(): GraphPattern {
	return {
		subjects: {
			A: subject(["io.example/Person/v1"]),
			B: subject(["io.example/Person/v1"]),
			S: subject(["io.example/School/v1"]),
			City: subject(["io.example/City/v1"], { $eq: { name: "Berlin" } }),
		},
		edges: [
			{
				from: "A",
				to: "S",
				linkTypes: ["io.example/StudiedAt/v1"],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "B",
				to: "S",
				linkTypes: ["io.example/StudiedAt/v1"],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "A",
				to: "City",
				linkTypes: ["io.example/LivesIn/v1"],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "B",
				to: "City",
				linkTypes: ["io.example/LivesIn/v1"],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
		],
		primarySubject: "A",
	};
}

describe("compilePattern — property-path injection guard", () => {
	function withWhere(where: GraphPattern["subjects"][string]["where"]): GraphPattern {
		return {
			subjects: { A: subject(["io.example/Person/v1"], where) },
			edges: [],
			primarySubject: "A",
		};
	}

	it("rejects a predicate path that breaks out of the json_extract string literal", () => {
		const result = compilePattern(withWhere({ $eq: { "x') UNION SELECT 1 --": "v" } }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("invalid-property-path");
	});

	it("rejects paths containing quotes / parens / whitespace / semicolons", () => {
		for (const bad of ["a'b", 'a"b', "a(b)", "a b", "a;b", "a)--"]) {
			expect(compilePattern(withWhere({ $exists: { [bad]: true } })).ok).toBe(false);
		}
	});

	it("still accepts legitimate dotted + array-index paths", () => {
		const result = compilePattern(withWhere({ $eq: { "address.items.0.city": "Berlin" } }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.sql).toContain("json_extract");
	});
});

describe("compilePattern — canonical example", () => {
	it("returns ok for the 'Persons sharing a Berlin school' pattern", () => {
		const result = compilePattern(canonicalExample());
		expect(result.ok).toBe(true);
	});

	it("emits SELECTs for every subject", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("A.id AS A_id");
		expect(result.sql).toContain("B.id AS B_id");
		expect(result.sql).toContain("S.id AS S_id");
		expect(result.sql).toContain("City.id AS City_id");
	});

	it("emits four JOINs against the links table (one per required edge)", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		const joinCount = (result.sql.match(/JOIN links L_\d+/g) ?? []).length;
		expect(joinCount).toBe(4);
	});

	it("selects created_by per subject so the repo can build a full row (ownerAppId)", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("A.created_by AS A_createdby");
		expect(result.sql).toContain("City.created_by AS City_createdby");
	});

	it("filters Berlin via json_extract on City's name property", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("json_extract(City.properties, '$.name') = ?");
		expect(result.params).toContain("Berlin");
	});

	it("enforces A.id != B.id when both subjects share a type (distinctness)", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("A.id != B.id");
		expect(result.distinctEnforced).toBe(true);
	});

	it("does not enforce A.id != S.id (different types, distinctness redundant)", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).not.toContain("A.id != S.id");
		expect(result.sql).not.toContain("S.id != A.id");
	});

	it("includes deleted_at IS NULL for every entity alias by default", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("A.deleted_at IS NULL");
		expect(result.sql).toContain("B.deleted_at IS NULL");
		expect(result.sql).toContain("S.deleted_at IS NULL");
		expect(result.sql).toContain("City.deleted_at IS NULL");
	});

	it("drops deleted_at clauses when includeDeleted is true (history-scrubber path)", () => {
		const result = compilePattern(canonicalExample(), { includeDeleted: true });
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).not.toContain("A.deleted_at IS NULL");
	});

	it("emits one bind param per type-IN value + the Berlin literal + the StudiedAt/LivesIn link types", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		// Each subject's type list contributes its values; City has + Berlin literal.
		// Each required edge contributes its linkTypes.
		expect(result.params).toEqual(
			expect.arrayContaining([
				"io.example/Person/v1", // A.type IN
				"io.example/Person/v1", // B.type IN
				"io.example/School/v1", // S.type IN
				"io.example/City/v1", // City.type IN
				"Berlin", // City.where
				"io.example/StudiedAt/v1", // L_0 + L_1
				"io.example/LivesIn/v1", // L_2 + L_3
			]),
		);
	});

	it("toggling distinctSubjects off removes the A.id != B.id constraint", () => {
		const result = compilePattern(canonicalExample(), { distinctSubjects: false });
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).not.toContain("A.id != B.id");
		expect(result.distinctEnforced).toBe(false);
	});
});

describe("compilePattern — edge match modes", () => {
	it("Optional uses LEFT JOIN rather than JOIN", () => {
		const p = tweakEdge(canonicalExample(), 0, (edge) => ({ ...edge, match: EdgeMatch.Optional }));
		const result = compilePattern(p);
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("LEFT JOIN links L_0");
	});

	it("Required edge selects the link row columns so the repo can return the edge", () => {
		const result = compilePattern(canonicalExample());
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("L_0.id AS L_0_id");
		expect(result.sql).toContain("L_0.source_entity_id AS L_0_src");
		expect(result.sql).toContain("L_0.dest_entity_id AS L_0_dst");
		expect(result.sql).toContain("L_0.link_type AS L_0_ltype");
		expect(result.sql).toContain("L_0.created_at AS L_0_lcreated");
	});

	it("Forbidden edge selects no link columns (no row id)", () => {
		const p = tweakEdge(canonicalExample(), 0, (edge) => ({
			...edge,
			match: EdgeMatch.Forbidden,
		}));
		const result = compilePattern(p);
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).not.toContain("L_0.id AS L_0_id");
	});

	it("Forbidden uses NOT EXISTS subquery and emits no row column", () => {
		const p = tweakEdge(canonicalExample(), 0, (edge) => ({
			...edge,
			match: EdgeMatch.Forbidden,
		}));
		const result = compilePattern(p);
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("NOT EXISTS (SELECT 1 FROM links L_0");
		expect(result.rowShape.edges[0]).toBeNull();
	});

	it("In direction swaps source / dest in the join clause", () => {
		const p = tweakEdge(canonicalExample(), 0, (edge) => ({
			...edge,
			direction: EdgeDirection.In,
		}));
		const result = compilePattern(p);
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toMatch(/L_0\.source_entity_id = S\.id AND L_0\.dest_entity_id = A\.id/);
	});

	it("Both direction emits a symmetric OR clause", () => {
		const p = tweakEdge(canonicalExample(), 0, (edge) => ({
			...edge,
			direction: EdgeDirection.Both,
		}));
		const result = compilePattern(p);
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("OR (L_0.source_entity_id = S.id");
	});
});

describe("compilePattern — predicate compiler", () => {
	it("compiles $and across multiple subject predicates", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], {
					$and: [{ $gt: { age: 18 } }, { $like: { name: "%alice%" } }],
				}),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("> ?");
		expect(result.sql).toContain("LIKE ?");
		expect(result.params).toContain(18);
		expect(result.params).toContain("%alice%");
	});

	it("compiles $or with parenthesized branches", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], {
					$or: [{ $eq: { name: "Alice" } }, { $eq: { name: "Bob" } }],
				}),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toMatch(/\(json_extract.*= \? OR json_extract.*= \?\)/);
	});

	it("compiles $in with the right number of placeholders", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], { $in: { city: ["Berlin", "Paris", "Rome"] } }),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("IN (?, ?, ?)");
		expect(result.params).toEqual(expect.arrayContaining(["Berlin", "Paris", "Rome"]));
	});

	it("$in with an empty array compiles to 0=1 (matches nothing)", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], { $in: { city: [] } }),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("0=1");
	});

	it("compiles $exists as IS NOT NULL", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], { $exists: { phone: true } }),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.sql).toContain("IS NOT NULL");
	});

	it("$contains compiles to LIKE %x%", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"], { $contains: { bio: "engineer" } }),
			},
			edges: [],
			primarySubject: "A",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.params).toContain("%engineer%");
		expect(result.sql).toContain("LIKE ?");
	});
});

describe("compilePattern — error paths", () => {
	it("rejects an empty pattern (no-subjects)", () => {
		const result = compilePattern({ subjects: {}, edges: [], primarySubject: "" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("no-subjects");
	});

	it("rejects a primarySubject not in the subjects map", () => {
		const result = compilePattern({
			subjects: { A: subject(["io.example/Person/v1"]) },
			edges: [],
			primarySubject: "Z",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("primary-subject-missing");
	});

	it("rejects an edge whose `from` references an unknown subject", () => {
		const result = compilePattern({
			subjects: { A: subject(["io.example/Person/v1"]) },
			edges: [
				{
					from: "Z",
					to: "A",
					linkTypes: ["io.example/Foo/v1"],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Required,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unknown-subject");
	});

	it("rejects an edge with empty linkTypes", () => {
		const result = compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"]),
				B: subject(["io.example/Person/v1"]),
			},
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: [],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Required,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("empty-link-types");
	});

	it("rejects invalid hops: min < 1, min > max, max over the cap, non-integers", () => {
		const base = (hops: readonly [number, number]) =>
			compilePattern({
				subjects: {
					A: subject(["io.example/Person/v1"]),
					B: subject(["io.example/Person/v1"]),
				},
				edges: [
					{
						from: "A",
						to: "B",
						linkTypes: ["io.example/Knows/v1"],
						direction: EdgeDirection.Out,
						match: EdgeMatch.Required,
						hops,
					},
				],
				primarySubject: "A",
			});
		for (const hops of [
			[0, 0],
			[3, 2],
			[1, 7],
			[1.5, 2],
		] as const) {
			const result = base(hops as unknown as readonly [number, number]);
			expect(result.ok, JSON.stringify(hops)).toBe(false);
			if (result.ok) continue;
			expect(result.error.code).toBe("invalid-hops");
		}
	});
});

describe("compilePattern — multi-hop CTEs (9.13.4)", () => {
	function hopPattern(direction: EdgeDirection, match: EdgeMatch, hops: readonly [number, number]) {
		return compilePattern({
			subjects: {
				A: subject(["io.example/Person/v1"]),
				B: subject(["io.example/Person/v1"]),
			},
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: ["io.example/Knows/v1"],
					direction,
					match,
					hops: hops as [number, number],
				},
			],
			primarySubject: "A",
		});
	}

	it("Required Out compiles a bounded recursive CTE joined src=from, dst=to", () => {
		const result = hopPattern(EdgeDirection.Out, EdgeMatch.Required, [1, 3]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.sql).toContain("WITH RECURSIVE H_0(src, dst, depth)");
		expect(result.sql).toContain("JOIN H_0 ON H_0.src = A.id AND H_0.dst = B.id");
		expect(result.sql).toContain("h.depth < ?");
		// linkTypes bind for the seed + the step, then the depth bound.
		expect(result.params.slice(0, 3)).toEqual(["io.example/Knows/v1", "io.example/Knows/v1", 3]);
		// No single link row to expose.
		expect(result.rowShape.edges[0]).toBeNull();
	});

	it("In swaps the join sides; min > 1 adds a bound depth floor", () => {
		const result = hopPattern(EdgeDirection.In, EdgeMatch.Required, [2, 4]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.sql).toContain("JOIN H_0 ON H_0.src = B.id AND H_0.dst = A.id AND H_0.depth >= ?");
	});

	it("Both seeds and steps both orientations (four CTE terms)", () => {
		const result = hopPattern(EdgeDirection.Both, EdgeMatch.Required, [1, 2]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const unions = result.sql.split("WITH RECURSIVE")[1]?.split("SELECT").length;
		expect(result.sql).toContain("UNION");
		expect(unions).toBeGreaterThanOrEqual(5);
	});

	it("bounds the recursive CTE with a defensive in-CTE LIMIT (one-orientation walk)", () => {
		const result = hopPattern(EdgeDirection.Out, EdgeMatch.Required, [1, 3]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The LIMIT closes the CTE compound so a dense link graph can't
		// materialize the intermediate unboundedly past the cost preflight.
		expect(result.sql).toContain("UNION SELECT h.src");
		expect(result.sql).toContain(`LIMIT ${MULTI_HOP_CTE_ROW_LIMIT})`);
	});

	it("bounds the Both-direction CTE with the same in-CTE LIMIT after four terms", () => {
		const result = hopPattern(EdgeDirection.Both, EdgeMatch.Required, [1, 2]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.sql).toContain(`LIMIT ${MULTI_HOP_CTE_ROW_LIMIT})`);
	});

	it("Forbidden compiles a NOT EXISTS over the CTE; Optional is a no-op", () => {
		const forbidden = hopPattern(EdgeDirection.Out, EdgeMatch.Forbidden, [1, 3]);
		expect(forbidden.ok).toBe(true);
		if (forbidden.ok) {
			expect(forbidden.sql).toContain("NOT EXISTS (SELECT 1 FROM H_0");
		}
		const optional = hopPattern(EdgeDirection.Out, EdgeMatch.Optional, [1, 3]);
		expect(optional.ok).toBe(true);
		if (optional.ok) {
			expect(optional.sql).not.toContain("H_0");
			expect(optional.rowShape.edges[0]).toBeNull();
		}
	});
});

describe("compilePattern — properties (shape stability)", () => {
	it("dedupes edges: the same {from,to,linkType} appearing twice still produces 4 JOINs (input order preserved, 2 duplicates → 2 JOINs), per-iteration we do NOT auto-dedupe but commutativity holds", () => {
		// Edge order independence: swapping edges 0 and 1 must produce the same
		// number of JOINs and the same set of bind params. We don't promise
		// byte-identical SQL — only structural equivalence.
		const p1 = canonicalExample();
		const p2 = canonicalExample();
		const [first, ...rest] = p2.edges;
		if (!first) throw new Error("fixture missing edges");
		p2.edges = [...rest, first]; // rotate
		const r1 = compilePattern(p1);
		const r2 = compilePattern(p2);
		if (!r1.ok || !r2.ok) throw new Error("expected ok");
		const joins1 = (r1.sql.match(/JOIN links L_\d+/g) ?? []).length;
		const joins2 = (r2.sql.match(/JOIN links L_\d+/g) ?? []).length;
		expect(joins1).toBe(joins2);
		expect(r1.params.length).toBe(r2.params.length);
	});

	it("subject reorder preserves the set of WHERE deleted_at clauses", () => {
		const p1: GraphPattern = {
			subjects: {
				A: subject(["io.example/Person/v1"]),
				B: subject(["io.example/Person/v1"]),
			},
			edges: [],
			primarySubject: "A",
		};
		const p2: GraphPattern = {
			subjects: {
				B: subject(["io.example/Person/v1"]),
				A: subject(["io.example/Person/v1"]),
			},
			edges: [],
			primarySubject: "A",
		};
		const r1 = compilePattern(p1);
		const r2 = compilePattern(p2);
		if (!r1.ok || !r2.ok) throw new Error("expected ok");
		const matches1 = (r1.sql.match(/deleted_at IS NULL/g) ?? []).length;
		const matches2 = (r2.sql.match(/deleted_at IS NULL/g) ?? []).length;
		expect(matches1).toBe(matches2);
	});
});
