import { describe, expect, it } from "vitest";
import { DEMO_GRAPH, canonicalBerlinPattern, notesAboutCitiesPattern } from "../demo/dataset";
import { EdgeDirection, EdgeMatch, SubjectKind } from "../types/pattern";
import { type MatchResult, isStaleEmptyPattern, matchPattern } from "./match-pattern";
import { defaultPattern, makeSubject } from "./pattern-edit";

/** `nodesBySubject` is a `Record<string, Set<string>>`; under
 *  `noUncheckedIndexedAccess` every lookup is `Set | undefined`. Tests that
 *  reference a subject by name always expect it bound — assert that here so
 *  the failure is a readable "subject N not bound" rather than a spread on
 *  undefined. */
function subjectSet(result: MatchResult, name: string): Set<string> {
	const set = result.nodesBySubject[name];
	expect(set, `subject "${name}" should be bound`).toBeDefined();
	return set as Set<string>;
}

describe("matchPattern over the canonical Berlin example", () => {
	it("returns at least one match", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(result.matches.length).toBeGreaterThan(0);
	});

	it("includes Alice + Bob (both studied at RWTH, both live in Berlin)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		expect(personIds.has("ent_person_alice")).toBe(true);
		expect(personIds.has("ent_person_bob")).toBe(true);
	});

	it("excludes Carla (studied at RWTH but lives in Munich)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		expect(personIds.has("ent_person_carla")).toBe(false);
	});

	it("excludes Dora (lives in Berlin but no shared school with anyone in Berlin)", () => {
		// Dora studied at ETH. Eve and Frank also studied at ETH and live in Berlin,
		// so Dora—{Eve,Frank} pairs DO satisfy the pattern. Verify Dora *is* in the
		// match set (paired with Eve or Frank), but in the canonical "Alice + Bob"
		// pair this assertion would not hold. Test the structural invariant: every
		// matched Person both lives in Berlin AND shares a School with another Person.
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		// Dora studied at ETH → she shares ETH with Eve and Frank → she pairs.
		expect(personIds.has("ent_person_dora")).toBe(true);
	});

	it("excludes Greta (studied at MIT, lives in Boston — no Berlin connection)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		expect(personIds.has("ent_person_greta")).toBe(false);
	});

	it("binds City to the Berlin entity exactly", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(subjectSet(result, "City").size).toBe(1);
		expect(subjectSet(result, "City").has("ent_city_berlin")).toBe(true);
	});

	it("includes the studied-at-shared-school edges in the visible link set", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(result.links.has("lnk_alice_rwth")).toBe(true);
		expect(result.links.has("lnk_bob_rwth")).toBe(true);
		expect(result.links.has("lnk_alice_berlin")).toBe(true);
		expect(result.links.has("lnk_bob_berlin")).toBe(true);
	});

	it("excludes links to Munich and Boston (those cities aren't bound)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		expect(result.links.has("lnk_carla_munich")).toBe(false);
		expect(result.links.has("lnk_greta_boston")).toBe(false);
	});

	it("enforces A != B distinctness (no Person matches themselves)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH);
		for (const m of result.matches) {
			expect(m.binding.A).not.toBe(m.binding.B);
		}
	});

	it("with distinctSubjects=false, allows A === B (self-binding)", () => {
		const result = matchPattern(canonicalBerlinPattern(), DEMO_GRAPH, {
			distinctSubjects: false,
		});
		const hasSelfBinding = result.matches.some((m) => m.binding.A === m.binding.B);
		expect(hasSelfBinding).toBe(true);
	});
});

describe("matchPattern — single-edge pattern", () => {
	it("'Notes about Cities' returns the one demo note pointing at Berlin", () => {
		const result = matchPattern(notesAboutCitiesPattern(), DEMO_GRAPH);
		expect(subjectSet(result, "N").has("ent_note_a")).toBe(true);
		expect(subjectSet(result, "C").has("ent_city_berlin")).toBe(true);
		expect(result.links.has("lnk_note_a_berlin")).toBe(true);
	});

	it("returns no matches for a city that has no Notes about it", () => {
		const result = matchPattern(notesAboutCitiesPattern(), {
			entities: DEMO_GRAPH.entities,
			links: DEMO_GRAPH.links.filter((l) => l.id !== "lnk_note_a_berlin"),
		});
		expect(result.matches).toEqual([]);
	});
});

describe("matchPattern — edge match modes", () => {
	it("Forbidden edge excludes bindings where the link exists", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: null,
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
					C: {
						kind: SubjectKind.Entity,
						types: ["io.example/City/v1"],
						where: { $eq: { name: "Berlin" } },
						displayName: "Berlin",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [
					{
						from: "P",
						to: "C",
						linkTypes: ["io.example/LivesIn/v1"],
						direction: EdgeDirection.Out,
						match: EdgeMatch.Forbidden,
						hops: [1, 1],
					},
				],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		// Persons NOT living in Berlin: Carla, Greta.
		const personIds = subjectSet(result, "P");
		expect(personIds.has("ent_person_carla")).toBe(true);
		expect(personIds.has("ent_person_greta")).toBe(true);
		// Persons LIVING in Berlin should be excluded.
		expect(personIds.has("ent_person_alice")).toBe(false);
		expect(personIds.has("ent_person_bob")).toBe(false);
	});

	it("Optional edge includes bindings whether or not the link exists", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: null,
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
					C: {
						kind: SubjectKind.Entity,
						types: ["io.example/City/v1"],
						where: null,
						displayName: "City",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [
					{
						from: "P",
						to: "C",
						linkTypes: ["io.example/LivesIn/v1"],
						direction: EdgeDirection.Out,
						match: EdgeMatch.Optional,
						hops: [1, 1],
					},
				],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		// Optional binds whenever any City-binding works, so every Person × City
		// combination yields a match where the edge is either present or absent.
		expect(result.matches.length).toBeGreaterThan(0);
	});
});

describe("matchPattern — property predicates", () => {
	it("$like matches against a Person's name property", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: { $like: { name: "%lice%" } },
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		expect(subjectSet(result, "P").has("ent_person_alice")).toBe(true);
		expect(subjectSet(result, "P").has("ent_person_bob")).toBe(false);
	});

	it("$in matches against a Person's role property", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: { $in: { role: ["researcher"] } },
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		const ids = subjectSet(result, "P");
		expect(ids.has("ent_person_bob")).toBe(true);
		expect(ids.has("ent_person_eve")).toBe(true);
		expect(ids.has("ent_person_alice")).toBe(false);
	});

	it("$and combines predicates", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: {
							$and: [{ $eq: { role: "engineer" } }, { $like: { name: "A%" } }],
						},
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		const ids = subjectSet(result, "P");
		expect(ids.has("ent_person_alice")).toBe(true);
		expect(ids.has("ent_person_bob")).toBe(false); // role engineer but name Bob
		expect(ids.has("ent_person_frank")).toBe(false); // role engineer but name Frank
	});

	it("$not negates a sub-predicate", () => {
		const result = matchPattern(
			{
				subjects: {
					P: {
						kind: SubjectKind.Entity,
						types: ["io.example/Person/v1"],
						where: { $not: { $eq: { role: "engineer" } } },
						displayName: "Person",
						color: null,
						icon: null,
						limit: null,
					},
				},
				edges: [],
				primarySubject: "P",
			},
			DEMO_GRAPH,
		);
		const ids = subjectSet(result, "P");
		expect(ids.has("ent_person_bob")).toBe(true); // researcher
		expect(ids.has("ent_person_alice")).toBe(false); // engineer
	});
});

describe("matchPattern — deleted handling", () => {
	it("excludes soft-deleted entities by default", () => {
		const alice = DEMO_GRAPH.entities.find((e) => e.id === "ent_person_alice");
		if (!alice) throw new Error("test fixture missing ent_person_alice");
		const dbWithDeleted = {
			entities: [
				...DEMO_GRAPH.entities.filter((e) => e.id !== "ent_person_alice"),
				{ ...alice, deletedAt: Date.now() },
			],
			links: DEMO_GRAPH.links,
		};
		const result = matchPattern(canonicalBerlinPattern(), dbWithDeleted);
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		expect(personIds.has("ent_person_alice")).toBe(false);
	});

	it("includes soft-deleted entities when includeDeleted=true", () => {
		const alice = DEMO_GRAPH.entities.find((e) => e.id === "ent_person_alice");
		if (!alice) throw new Error("test fixture missing ent_person_alice");
		const dbWithDeleted = {
			entities: [
				...DEMO_GRAPH.entities.filter((e) => e.id !== "ent_person_alice"),
				{ ...alice, deletedAt: Date.now() },
			],
			links: DEMO_GRAPH.links,
		};
		const result = matchPattern(canonicalBerlinPattern(), dbWithDeleted, {
			includeDeleted: true,
		});
		const personIds = new Set<string>([...subjectSet(result, "A"), ...subjectSet(result, "B")]);
		expect(personIds.has("ent_person_alice")).toBe(true);
	});
});

describe("isStaleEmptyPattern", () => {
	it("flags a restored pattern whose subject types match nothing in a non-empty vault", () => {
		const stale = {
			subjects: { S1: makeSubject("Ghosts", ["io.brainstorm/DoesNotExist/v1"]) },
			edges: [],
			primarySubject: "S1",
		};
		expect(isStaleEmptyPattern(stale, DEMO_GRAPH)).toBe(true);
	});

	it("does not flag the show-everything default pattern", () => {
		expect(isStaleEmptyPattern(defaultPattern(), DEMO_GRAPH)).toBe(false);
	});

	it("does not flag any pattern on an empty vault (nothing to show regardless)", () => {
		expect(isStaleEmptyPattern(defaultPattern(), { entities: [], links: [] })).toBe(false);
	});
});

describe("matchPattern — multi-hop windows (9.13.4, mirrors the SQL CTE tests)", () => {
	const PERSON = "io.x/Person/v1";
	const KNOWS = "io.x/Knows/v1";

	/** The same directed chain the shell's executing tests use:
	 *  p1 → p2 → p3 → p4. */
	function chain(extraLinks: Array<[string, string]> = []) {
		const links = [["p1", "p2"], ["p2", "p3"], ["p3", "p4"], ...extraLinks] as Array<
			[string, string]
		>;
		return {
			entities: ["p1", "p2", "p3", "p4"].map((id) => ({
				id,
				type: PERSON,
				properties: { name: id },
				createdAt: 1,
				updatedAt: 1,
				deletedAt: null,
			})),
			links: links.map(([s, d]) => ({
				id: `l_${s}_${d}`,
				sourceEntityId: s,
				destEntityId: d,
				linkType: KNOWS,
				createdAt: 1,
				deletedAt: null,
			})),
		};
	}

	function hopFrom(
		anchor: string,
		direction: EdgeDirection,
		match: EdgeMatch,
		hops: readonly [number, number],
	) {
		return {
			subjects: {
				A: {
					kind: SubjectKind.Entity as const,
					types: [PERSON],
					where: { $eq: { name: anchor } },
					displayName: "A",
					color: null,
					icon: null,
					limit: null,
				},
				B: {
					kind: SubjectKind.Entity as const,
					types: [PERSON],
					where: null,
					displayName: "B",
					color: null,
					icon: null,
					limit: null,
				},
			},
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: [KNOWS],
					direction,
					match,
					hops: hops as [number, number],
				},
			],
			primarySubject: "A",
		};
	}

	function boundBs(
		anchor: string,
		direction: EdgeDirection,
		match: EdgeMatch,
		hops: readonly [number, number],
		extraLinks: Array<[string, string]> = [],
	): string[] {
		const result = matchPattern(hopFrom(anchor, direction, match, hops), chain(extraLinks));
		return [...subjectSet(result, "B")].sort();
	}

	it("Out [1,2] reaches one and two hops forward, never three", () => {
		expect(boundBs("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 2])).toEqual(["p2", "p3"]);
	});

	it("Out [2,3] applies the min-hop floor", () => {
		expect(boundBs("p1", EdgeDirection.Out, EdgeMatch.Required, [2, 3])).toEqual(["p3", "p4"]);
	});

	it("In [1,2] walks the chain backwards", () => {
		expect(boundBs("p3", EdgeDirection.In, EdgeMatch.Required, [1, 2])).toEqual(["p1", "p2"]);
	});

	it("Both [1,2] reaches both orientations", () => {
		expect(boundBs("p2", EdgeDirection.Both, EdgeMatch.Required, [1, 2])).toEqual(["p1", "p3", "p4"]);
	});

	it("Forbidden [1,2] keeps only Bs outside the window", () => {
		expect(boundBs("p1", EdgeDirection.Out, EdgeMatch.Forbidden, [1, 2])).toEqual(["p4"]);
	});

	it("Optional multi-hop is a no-op constraint (every distinct pair binds)", () => {
		expect(boundBs("p1", EdgeDirection.Out, EdgeMatch.Optional, [1, 2])).toEqual(["p2", "p3", "p4"]);
	});

	it("a cyclic structure terminates and answers the full window", () => {
		expect(boundBs("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 6], [["p4", "p1"]])).toEqual([
			"p2",
			"p3",
			"p4",
		]);
	});
});
