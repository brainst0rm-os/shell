import { describe, expect, it } from "vitest";
import {
	type EdgeConstraint,
	EdgeDirection,
	EdgeMatch,
	type GraphPattern,
	PATTERN_MAX_HOPS,
	SubjectKind,
} from "../types/pattern";
import { validatePattern } from "./pattern-validate";

function newSubject(types: string[]): GraphPattern["subjects"][string] {
	return {
		kind: SubjectKind.Entity,
		types,
		where: null,
		displayName: types[0] ?? "Any",
		color: null,
		icon: null,
		limit: null,
	};
}

/** Replace the edge at `index` with the result of `mutator(edge)`. Throws
 *  loudly if the fixture is missing an edge there — keeps tests readable
 *  without the non-null `!` idiom Biome forbids. */
function tweakEdge(
	pattern: GraphPattern,
	index: number,
	mutator: (edge: EdgeConstraint) => EdgeConstraint,
): GraphPattern {
	const edge = pattern.edges[index];
	if (!edge) throw new Error(`test fixture missing edge at index ${index}`);
	const next = [...pattern.edges];
	next[index] = mutator(edge);
	return { ...pattern, edges: next };
}

function canonicalExamplePattern(): GraphPattern {
	return {
		subjects: {
			A: newSubject(["io.example/Person/v1"]),
			B: newSubject(["io.example/Person/v1"]),
			S: newSubject(["io.example/School/v1"]),
			City: {
				...newSubject(["io.example/City/v1"]),
				where: { $eq: { name: "Berlin" } },
			},
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

describe("validatePattern", () => {
	it("accepts the canonical 'Persons sharing a Berlin school' pattern", () => {
		const result = validatePattern(canonicalExamplePattern());
		expect(result.ok).toBe(true);
	});

	it("rejects an empty pattern with the no-subjects code", () => {
		const result = validatePattern({ subjects: {}, edges: [], primarySubject: "" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "no-subjects")).toBe(true);
	});

	it("rejects an edge whose `from` references a missing subject", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({ ...edge, from: "Z" }));
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(
			result.issues.some(
				(i) => i.code === "unknown-subject" && i.subjectName === "Z" && i.side === "from",
			),
		).toBe(true);
	});

	it("rejects an edge with empty linkTypes (any-type-edge is too expensive)", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({ ...edge, linkTypes: [] }));
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "edge-empty-link-types")).toBe(true);
	});

	it("rejects an edge whose max hops exceeds PATTERN_MAX_HOPS", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({
			...edge,
			hops: [1, PATTERN_MAX_HOPS + 1],
		}));
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "hops-out-of-range")).toBe(true);
	});

	it("rejects an edge whose min hops exceeds max hops", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({ ...edge, hops: [3, 1] }));
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "hops-inverted")).toBe(true);
	});

	it("rejects a primarySubject that's not in the subjects map", () => {
		const p = canonicalExamplePattern();
		p.primarySubject = "Nonexistent";
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "primary-subject-missing")).toBe(true);
	});

	it("rejects forbidden edges with multi-hop (semantically ambiguous)", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({
			...edge,
			match: EdgeMatch.Forbidden,
			hops: [1, 3],
		}));
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "forbidden-edge-on-multi-hop")).toBe(true);
	});

	it("accepts forbidden edges on single hop (just an absence assertion)", () => {
		const p = tweakEdge(canonicalExamplePattern(), 0, (edge) => ({
			...edge,
			match: EdgeMatch.Forbidden,
			hops: [1, 1],
		}));
		const result = validatePattern(p);
		expect(result.ok).toBe(true);
	});

	it("flags a subject with no entity-type constraint (any-type is expensive)", () => {
		const p = canonicalExamplePattern();
		p.subjects.A = newSubject([]);
		const result = validatePattern(p);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.some((i) => i.code === "subject-empty-types" && i.subjectName === "A")).toBe(
			true,
		);
	});
});
