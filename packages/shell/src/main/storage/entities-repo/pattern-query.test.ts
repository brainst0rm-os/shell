/**
 * 9.13.3 — `EntitiesRepository.queryPattern` against a real `entities.db`.
 *
 * Covers the shape-equivalence properties the implementation plan calls
 * out (commutativity of edge order, deduplication of identical edges)
 * plus match-mode (Required / Optional / Forbidden), direction-mode
 * correctness, distinctness, and the cost-cap guard firing. Property
 * tests follow this repo's established generative-loop convention (no
 * fast-check dependency — see `ipc/envelope.test.ts`).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EdgeDirection, EdgeMatch, type GraphPattern, SubjectKind } from "../../entities/pattern";
import { DataStores } from "../data-stores";
import { EntitiesRepository } from "./entities-repo";

const PERSON = "io.x/Person/v1";
const SCHOOL = "io.x/School/v1";
const KNOWS = "io.x/Knows/v1";
const STUDIED_AT = "io.x/StudiedAt/v1";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-pattern-"));
	const stores = new DataStores(vaultDir);
	const db = await stores.open("entities");
	return { vaultDir, stores, repo: new EntitiesRepository(db) };
}

function subject(types: string[], where: GraphPattern["subjects"][string]["where"] = null) {
	return {
		kind: SubjectKind.Entity as const,
		types,
		where,
		displayName: types[0] ?? "Any",
	};
}

describe("EntitiesRepository.queryPattern", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
		// Two people who both studied at the same school + a knows edge
		// between them. Plus an isolated person with no edges.
		env.repo.create({
			id: "p1",
			type: PERSON,
			properties: { name: "Ann" },
			createdBy: "io.x",
			now: 10,
			dekId: null,
		});
		env.repo.create({
			id: "p2",
			type: PERSON,
			properties: { name: "Bo" },
			createdBy: "io.x",
			now: 20,
			dekId: null,
		});
		env.repo.create({
			id: "p3",
			type: PERSON,
			properties: { name: "Cy" },
			createdBy: "io.x",
			now: 30,
			dekId: null,
		});
		env.repo.create({
			id: "s1",
			type: SCHOOL,
			properties: { name: "MIT" },
			createdBy: "io.x",
			now: 5,
			dekId: null,
		});
		env.repo.putLink({
			id: "l_p1_s1",
			sourceEntityId: "p1",
			destEntityId: "s1",
			linkType: STUDIED_AT,
			createdAt: 11,
		});
		env.repo.putLink({
			id: "l_p2_s1",
			sourceEntityId: "p2",
			destEntityId: "s1",
			linkType: STUDIED_AT,
			createdAt: 21,
		});
		env.repo.putLink({
			id: "l_p1_p2",
			sourceEntityId: "p1",
			destEntityId: "p2",
			linkType: KNOWS,
			createdAt: 22,
		});
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	const sharedSchool = (): GraphPattern => ({
		subjects: { A: subject([PERSON]), B: subject([PERSON]), S: subject([SCHOOL]) },
		edges: [
			{
				from: "A",
				to: "S",
				linkTypes: [STUDIED_AT],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
			{
				from: "B",
				to: "S",
				linkTypes: [STUDIED_AT],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1],
			},
		],
		primarySubject: "A",
	});

	it("resolves the canonical 'two people sharing a school' pattern", () => {
		const r = env.repo.queryPattern(sharedSchool());
		if (!r.ok) throw new Error("expected ok");
		const ids = r.result.entities.map((e) => e.id).sort();
		expect(ids).toEqual(["p1", "p2", "s1"]);
		// p3 is a Person but studied nowhere → never bound.
		expect(ids).not.toContain("p3");
	});

	it("matches carry the resolved link rows (history needs created_at)", () => {
		const r = env.repo.queryPattern(sharedSchool());
		if (!r.ok) throw new Error("expected ok");
		const studied = r.result.links
			.filter((l) => l.linkType === STUDIED_AT)
			.map((l) => l.id)
			.sort();
		expect(studied).toEqual(["l_p1_s1", "l_p2_s1"]);
		expect(r.result.links.find((l) => l.id === "l_p1_s1")?.createdAt).toBe(11);
	});

	// ── Property: commutativity of edge order ──────────────────────────
	it("PROPERTY: edge order does not change the matched entity / link sets", () => {
		const base = sharedSchool();
		const baseRes = env.repo.queryPattern(base);
		if (!baseRes.ok) throw new Error("expected ok");
		const norm = (r: typeof baseRes) => ({
			entities: r.result.entities.map((e) => e.id).sort(),
			links: r.result.links.map((l) => l.id).sort(),
		});
		const want = norm(baseRes);

		// Every permutation of the edge array must produce the same sets.
		const perms: number[][] = [
			[0, 1],
			[1, 0],
		];
		for (const order of perms) {
			const permuted: GraphPattern = {
				...base,
				edges: order.map((i) => {
					const e = base.edges[i];
					if (!e) throw new Error("bad fixture");
					return e;
				}),
			};
			const r = env.repo.queryPattern(permuted);
			if (!r.ok) throw new Error("expected ok");
			expect(norm(r)).toEqual(want);
		}
	});

	// ── Property: identical-edge deduplication ─────────────────────────
	it("PROPERTY: appending a duplicate identical edge does not change the result set", () => {
		const base = sharedSchool();
		const baseRes = env.repo.queryPattern(base);
		if (!baseRes.ok) throw new Error("expected ok");
		const want = {
			entities: baseRes.result.entities.map((e) => e.id).sort(),
			links: baseRes.result.links.map((l) => l.id).sort(),
		};
		for (let dupCount = 1; dupCount <= 4; dupCount += 1) {
			const firstEdge = base.edges[0];
			if (!firstEdge) throw new Error("bad fixture");
			const withDupes: GraphPattern = {
				...base,
				edges: [...base.edges, ...Array.from({ length: dupCount }, () => ({ ...firstEdge }))],
			};
			const r = env.repo.queryPattern(withDupes);
			if (!r.ok) throw new Error("expected ok");
			expect({
				entities: r.result.entities.map((e) => e.id).sort(),
				links: r.result.links.map((l) => l.id).sort(),
			}).toEqual(want);
		}
	});

	// ── Match modes ────────────────────────────────────────────────────
	it("Required edge excludes a subject binding with no matching link", () => {
		const p: GraphPattern = {
			subjects: { A: subject([PERSON]), S: subject([SCHOOL]) },
			edges: [
				{
					from: "A",
					to: "S",
					linkTypes: [STUDIED_AT],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Required,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		};
		const r = env.repo.queryPattern(p);
		if (!r.ok) throw new Error("expected ok");
		const people = r.result.entities
			.filter((e) => e.type === PERSON)
			.map((e) => e.id)
			.sort();
		expect(people).toEqual(["p1", "p2"]); // p3 never studied → excluded
	});

	it("Optional edge keeps unbound subjects (LEFT JOIN semantics)", () => {
		const p: GraphPattern = {
			subjects: { A: subject([PERSON]), S: subject([SCHOOL]) },
			edges: [
				{
					from: "A",
					to: "S",
					linkTypes: [STUDIED_AT],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Optional,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		};
		const r = env.repo.queryPattern(p);
		if (!r.ok) throw new Error("expected ok");
		const people = r.result.entities
			.filter((e) => e.type === PERSON)
			.map((e) => e.id)
			.sort();
		expect(people).toEqual(["p1", "p2", "p3"]); // p3 still present, unbound
	});

	it("Forbidden edge excludes subjects that DO have the link", () => {
		const p: GraphPattern = {
			subjects: { A: subject([PERSON]), S: subject([SCHOOL]) },
			edges: [
				{
					from: "A",
					to: "S",
					linkTypes: [STUDIED_AT],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Forbidden,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		};
		const r = env.repo.queryPattern(p);
		if (!r.ok) throw new Error("expected ok");
		const people = r.result.entities
			.filter((e) => e.type === PERSON)
			.map((e) => e.id)
			.sort();
		expect(people).toEqual(["p3"]); // only the person who studied nowhere
	});

	// ── Direction modes ────────────────────────────────────────────────
	it("In direction inverts source / dest (p2 KNOWS-inbound from p1)", () => {
		const outward: GraphPattern = {
			subjects: { A: subject([PERSON]), B: subject([PERSON]) },
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: [KNOWS],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Required,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		};
		const inward: GraphPattern = {
			...outward,
			edges: [{ ...outward.edges[0], direction: EdgeDirection.In } as GraphPattern["edges"][number]],
		};
		const ro = env.repo.queryPattern(outward);
		const ri = env.repo.queryPattern(inward);
		if (!ro.ok || !ri.ok) throw new Error("expected ok");
		// l_p1_p2: p1 --KNOWS--> p2. Out binds (A=p1,B=p2); In binds (A=p2,B=p1).
		expect(
			ro.result.matches.some((m) => m.subjects.A?.id === "p1" && m.subjects.B?.id === "p2"),
		).toBe(true);
		expect(
			ri.result.matches.some((m) => m.subjects.A?.id === "p2" && m.subjects.B?.id === "p1"),
		).toBe(true);
	});

	it("Both direction matches the KNOWS edge regardless of orientation", () => {
		const p: GraphPattern = {
			subjects: { A: subject([PERSON]), B: subject([PERSON]) },
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: [KNOWS],
					direction: EdgeDirection.Both,
					match: EdgeMatch.Required,
					hops: [1, 1],
				},
			],
			primarySubject: "A",
		};
		const r = env.repo.queryPattern(p);
		if (!r.ok) throw new Error("expected ok");
		expect(r.result.links.some((l) => l.id === "l_p1_p2")).toBe(true);
	});

	// ── Distinctness ───────────────────────────────────────────────────
	it("distinct subjects (default) prevents A==B self-binding for same-type subjects", () => {
		const p = sharedSchool();
		const r = env.repo.queryPattern(p);
		if (!r.ok) throw new Error("expected ok");
		for (const m of r.result.matches) {
			expect(m.subjects.A?.id).not.toBe(m.subjects.B?.id);
		}
	});

	it("distinctSubjects:false allows the same entity to bind A and B", () => {
		const p = sharedSchool();
		const r = env.repo.queryPattern(p, { distinctSubjects: false });
		if (!r.ok) throw new Error("expected ok");
		expect(r.result.matches.some((m) => m.subjects.A?.id === m.subjects.B?.id)).toBe(true);
	});

	// ── Cost-cap guard ─────────────────────────────────────────────────
	it("rejects a pattern whose estimate exceeds the cost ceiling (never executes)", () => {
		// 3 Person rows × 3 Person rows × 1 School ≈ structural product;
		// a ceiling of 1 forces the guard regardless of dataset size.
		const r = env.repo.queryPattern(sharedSchool(), { costCeiling: 1 });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		if (!("cost" in r)) throw new Error("expected a cost error");
		expect(r.cost.code).toBe("pattern-too-expensive");
		expect(r.cost.ceiling).toBe(1);
		expect(r.cost.estimatedRows).toBeGreaterThan(1);
	});

	it("a generous ceiling lets the same pattern through", () => {
		const r = env.repo.queryPattern(sharedSchool(), { costCeiling: 1_000_000 });
		expect(r.ok).toBe(true);
	});

	it("PROPERTY: estimate is monotonic — more same-type entities never lowers it", () => {
		const first = env.repo.queryPattern(sharedSchool(), { costCeiling: 1_000_000 });
		if (!first.ok) throw new Error("expected ok");
		const before = first.estimatedRows;
		for (let i = 0; i < 5; i += 1) {
			env.repo.create({
				id: `extra_${i}`,
				type: PERSON,
				properties: {},
				createdBy: "io.x",
				now: 100 + i,
				dekId: null,
			});
		}
		const after = env.repo.queryPattern(sharedSchool(), { costCeiling: 1_000_000 });
		if (!after.ok) throw new Error("expected ok");
		expect(after.estimatedRows).toBeGreaterThanOrEqual(before);
	});

	// ── Compile-error passthrough ──────────────────────────────────────
	it("surfaces a compile error (invalid hops) without executing", () => {
		const p: GraphPattern = {
			subjects: { A: subject([PERSON]), B: subject([PERSON]) },
			edges: [
				{
					from: "A",
					to: "B",
					linkTypes: [KNOWS],
					direction: EdgeDirection.Out,
					match: EdgeMatch.Required,
					hops: [0, 3],
				},
			],
			primarySubject: "A",
		};
		const r = env.repo.queryPattern(p);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		if (!("compile" in r)) throw new Error("expected a compile error");
		expect(r.compile.error.code).toBe("invalid-hops");
	});
});

describe("EntitiesRepository.queryPattern — multi-hop (9.13.4)", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
		// A directed Knows chain p1 → p2 → p3 → p4 (no shortcuts).
		for (const [id, now] of [
			["p1", 10],
			["p2", 20],
			["p3", 30],
			["p4", 40],
		] as const) {
			env.repo.create({
				id,
				type: PERSON,
				properties: { name: id },
				createdBy: "io.x",
				now,
				dekId: null,
			});
		}
		for (const [src, dst] of [
			["p1", "p2"],
			["p2", "p3"],
			["p3", "p4"],
		] as const) {
			env.repo.putLink({
				id: `l_${src}_${dst}`,
				sourceEntityId: src,
				destEntityId: dst,
				linkType: KNOWS,
				createdAt: 50,
			});
		}
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	/** Pin A to one person by name; B stays any person. The matched-entity
	 *  set then reads as {A} ∪ {every B in the hop window}. */
	const hopFrom = (
		anchor: string,
		direction: EdgeDirection,
		match: EdgeMatch,
		hops: readonly [number, number],
	): GraphPattern => ({
		subjects: {
			A: subject([PERSON], { $eq: { name: anchor } }),
			B: subject([PERSON]),
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
	});

	function matchedIds(pattern: GraphPattern): string[] {
		const r = env.repo.queryPattern(pattern);
		expect(r.ok).toBe(true);
		if (!r.ok) return [];
		return r.result.entities.map((e) => e.id).sort();
	}

	it("Out [1,2] reaches one and two hops forward, never three", () => {
		expect(matchedIds(hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 2]))).toEqual([
			"p1",
			"p2",
			"p3",
		]);
	});

	it("Out [2,3] applies the min-hop floor (direct neighbour excluded)", () => {
		expect(matchedIds(hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [2, 3]))).toEqual([
			"p1",
			"p3",
			"p4",
		]);
	});

	it("In [1,2] walks the chain backwards", () => {
		expect(matchedIds(hopFrom("p3", EdgeDirection.In, EdgeMatch.Required, [1, 2]))).toEqual([
			"p1",
			"p2",
			"p3",
		]);
	});

	it("Both [1,2] reaches both orientations within the window", () => {
		expect(matchedIds(hopFrom("p2", EdgeDirection.Both, EdgeMatch.Required, [1, 2]))).toEqual([
			"p1",
			"p2",
			"p3",
			"p4",
		]);
	});

	it("Forbidden [1,2] keeps only Bs NOT connected within two hops", () => {
		// From p1, only p4 sits outside the 2-hop window (B ≠ A via distinct).
		expect(matchedIds(hopFrom("p1", EdgeDirection.Out, EdgeMatch.Forbidden, [1, 2]))).toEqual([
			"p1",
			"p4",
		]);
	});

	it("a cyclic link structure terminates and still answers", () => {
		// Close the loop p4 → p1: the graph now cycles.
		env.repo.putLink({
			id: "l_p4_p1",
			sourceEntityId: "p4",
			destEntityId: "p1",
			linkType: KNOWS,
			createdAt: 60,
		});
		expect(matchedIds(hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 6]))).toEqual([
			"p1",
			"p2",
			"p3",
			"p4",
		]);
	});

	it("folds a CTE-breadth term into the cost estimate for a multi-hop edge", () => {
		// Same subject sets, same link types — only the hop window differs. The
		// recursive CTE seeds from the whole links table (the subject product
		// can't see it), so the multi-hop estimate must exceed the single-hop
		// one by the breadth term (live KNOWS links × maxHops).
		const single = env.repo.queryPattern(
			hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 1]),
			{ costCeiling: 10_000_000 },
		);
		const multi = env.repo.queryPattern(
			hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 3]),
			{ costCeiling: 10_000_000 },
		);
		expect(single.ok).toBe(true);
		expect(multi.ok).toBe(true);
		if (!single.ok || !multi.ok) return;
		expect(multi.estimatedRows).toBeGreaterThan(single.estimatedRows);
	});

	it("the multi-hop breadth term can trip the cost ceiling the subject product alone would clear", () => {
		// Tiny subject sets (A pinned to one person, B any of four) but the
		// edge's link-graph term pushes the estimate past a ceiling sized just
		// above the subject product — exactly the pathological shape that
		// otherwise passes preflight then explodes on execution.
		const r = env.repo.queryPattern(hopFrom("p1", EdgeDirection.Out, EdgeMatch.Required, [1, 3]), {
			costCeiling: 5,
		});
		expect(r.ok).toBe(false);
		if (r.ok || !("cost" in r)) throw new Error("expected a cost-cap rejection");
		expect(r.cost.code).toBe("pattern-too-expensive");
	});
});
