/**
 * Y.Doc ⇄ `GraphPattern` codec tests (9.13.2).
 *
 * Coverage shape:
 *   - **Trivial round-trip**: the 9.13.2 green-bar — single subject, no
 *     edges, no `where` — encode then decode yields a structurally
 *     identical `GraphPattern`.
 *   - **Empty / fresh doc**: decoding a doc that's never been written to
 *     returns the trivial default pattern (mirrors `defaultPattern()`).
 *   - **Richer round-trip**: multi-subject + multi-edge + `where` round-
 *     trips cleanly. Lands now so 9.13.4 (multi-hop CTE) and 9.13.6
 *     (per-view coords) don't trip the codec when they ladder on.
 *   - **Two-doc convergence**: encoding the same pattern into two
 *     separate docs and exchanging updates yields identical state — the
 *     structural projection per OQ-GR-1 must merge cleanly without
 *     clobber, which is the whole reason the resolution picked option (a).
 *   - **Tolerant decode**: a doc with missing optional fields decodes to
 *     sensible defaults rather than throwing.
 *
 * The codec is the foundation of `Graph/v1` persistence; the test bar
 * is therefore "the trivial case is bulletproof, the richer case is
 * verified to round-trip" — matching the iteration's explicit scope.
 */

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { EdgeDirection, EdgeMatch, type GraphPattern, SubjectKind } from "../types/pattern";
import { GraphDocField, decodePatternFromDoc, encodePatternIntoDoc } from "./graph-yjs-codec";

function trivialPattern(): GraphPattern {
	return {
		subjects: {
			S1: {
				kind: SubjectKind.Entity,
				types: [],
				where: null,
				displayName: "All entities",
				color: null,
				icon: null,
				limit: null,
			},
		},
		edges: [],
		primarySubject: "S1",
	};
}

function singleTypedSubjectPattern(): GraphPattern {
	return {
		subjects: {
			S1: {
				kind: SubjectKind.Entity,
				types: ["brainstorm/Note/v1"],
				where: null,
				displayName: "Notes",
				color: null,
				icon: null,
				limit: null,
			},
		},
		edges: [],
		primarySubject: "S1",
	};
}

function richerPattern(): GraphPattern {
	return {
		subjects: {
			Person: {
				kind: SubjectKind.Entity,
				types: ["brainstorm/Person/v1"],
				where: { $eq: { "properties.city": "Berlin" } },
				displayName: "People",
				color: "#aabbcc",
				icon: null,
				limit: 100,
			},
			School: {
				kind: SubjectKind.Entity,
				types: ["brainstorm/School/v1"],
				where: null,
				displayName: "Schools",
				color: null,
				icon: null,
				limit: null,
			},
		},
		edges: [
			{
				from: "Person",
				to: "School",
				linkTypes: ["attended"],
				direction: EdgeDirection.Out,
				match: EdgeMatch.Required,
				hops: [1, 1] as const,
			},
		],
		primarySubject: "Person",
	};
}

describe("graph-yjs-codec — trivial pattern (9.13.2 green bar)", () => {
	it("round-trips a single-subject, no-edge, no-where pattern through a Y.Doc", () => {
		const pattern = trivialPattern();
		const doc = new Y.Doc();

		encodePatternIntoDoc(doc, pattern);
		const decoded = decodePatternFromDoc(doc);

		expect(decoded).toEqual(pattern);
	});

	it("round-trips a single-subject pattern with one entity-type constraint", () => {
		const pattern = singleTypedSubjectPattern();
		const doc = new Y.Doc();

		encodePatternIntoDoc(doc, pattern);
		const decoded = decodePatternFromDoc(doc);

		expect(decoded).toEqual(pattern);
	});

	it("decodes a freshly-minted Y.Doc into the trivial default pattern", () => {
		const doc = new Y.Doc();
		const decoded = decodePatternFromDoc(doc);

		expect(decoded.primarySubject).toBe("S1");
		expect(Object.keys(decoded.subjects)).toEqual(["S1"]);
		expect(decoded.edges).toEqual([]);
		const s1 = decoded.subjects.S1;
		expect(s1).toBeDefined();
		expect(s1?.types).toEqual([]);
		expect(s1?.where).toBeNull();
	});

	it("populates the documented top-level Y.Doc fields per OQ-GR-1", () => {
		const doc = new Y.Doc();
		encodePatternIntoDoc(doc, trivialPattern());

		// Subjects → Y.Map keyed by subject name.
		const subjectsMap = doc.getMap(GraphDocField.Subjects);
		expect(subjectsMap.has("S1")).toBe(true);

		// Edges → Y.Array.
		const edgesArr = doc.getArray(GraphDocField.Edges);
		expect(edgesArr.length).toBe(0);

		// primarySubject → scalar on the doc's metadata map.
		const meta = doc.getMap("graphMeta");
		expect(meta.get(GraphDocField.PrimarySubject)).toBe("S1");
	});
});

describe("graph-yjs-codec — richer round-trips", () => {
	it("round-trips a multi-subject + multi-edge + where pattern", () => {
		const pattern = richerPattern();
		const doc = new Y.Doc();

		encodePatternIntoDoc(doc, pattern);
		const decoded = decodePatternFromDoc(doc);

		expect(decoded).toEqual(pattern);
	});

	it("two encode passes are idempotent (rewriting the same pattern is a no-op decode)", () => {
		const pattern = richerPattern();
		const doc = new Y.Doc();

		encodePatternIntoDoc(doc, pattern);
		const firstDecode = decodePatternFromDoc(doc);
		encodePatternIntoDoc(doc, pattern);
		const secondDecode = decodePatternFromDoc(doc);

		expect(firstDecode).toEqual(pattern);
		expect(secondDecode).toEqual(pattern);
	});

	it("removing a subject from the pattern removes it from the doc on re-encode", () => {
		const doc = new Y.Doc();
		encodePatternIntoDoc(doc, richerPattern());
		expect((doc.getMap(GraphDocField.Subjects) as Y.Map<unknown>).has("School")).toBe(true);

		const richer = richerPattern();
		const personSubject = richer.subjects.Person;
		if (!personSubject) throw new Error("test setup: richer pattern missing Person subject");
		const without: GraphPattern = {
			subjects: { Person: personSubject },
			edges: [],
			primarySubject: "Person",
		};
		encodePatternIntoDoc(doc, without);

		const subjectsMap = doc.getMap(GraphDocField.Subjects) as Y.Map<unknown>;
		expect(subjectsMap.has("School")).toBe(false);
		expect(subjectsMap.has("Person")).toBe(true);
	});
});

describe("graph-yjs-codec — CRDT convergence (OQ-GR-1 structural rationale)", () => {
	it("two docs converge to the same decoded pattern after exchanging updates", () => {
		const pattern = richerPattern();
		const docA = new Y.Doc();
		const docB = new Y.Doc();

		encodePatternIntoDoc(docA, pattern);
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

		const decodedA = decodePatternFromDoc(docA);
		const decodedB = decodePatternFromDoc(docB);

		expect(decodedA).toEqual(pattern);
		expect(decodedB).toEqual(decodedA);
	});

	it("concurrent display-name edits on the same subject converge (last-write per field)", () => {
		const docA = new Y.Doc();
		encodePatternIntoDoc(docA, trivialPattern());
		const docB = new Y.Doc();
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

		// Two devices rename S1 concurrently.
		const subjectsA = docA.getMap(GraphDocField.Subjects).get("S1") as Y.Map<unknown>;
		const subjectsB = docB.getMap(GraphDocField.Subjects).get("S1") as Y.Map<unknown>;
		subjectsA.set("displayName", "Everything");
		subjectsB.set("displayName", "Vault");

		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

		const decodedA = decodePatternFromDoc(docA);
		const decodedB = decodePatternFromDoc(docB);
		// CRDT picks a winner — but both docs agree on the winner.
		expect(decodedA).toEqual(decodedB);
	});
});

describe("graph-yjs-codec — tolerant decode", () => {
	it("a subject with no `types` array decodes as the empty type list", () => {
		const doc = new Y.Doc();
		// Manually plant a subject with no `types` field.
		doc.transact(() => {
			const subjectsMap = doc.getMap(GraphDocField.Subjects) as Y.Map<unknown>;
			const smap = new Y.Map<unknown>();
			smap.set("kind", "entity");
			smap.set("displayName", "Bare");
			subjectsMap.set("Bare", smap);
		});

		const decoded = decodePatternFromDoc(doc);
		expect(decoded.subjects.Bare?.types).toEqual([]);
		expect(decoded.subjects.Bare?.displayName).toBe("Bare");
	});

	it("an unknown direction / match value falls back to the documented defaults", () => {
		const doc = new Y.Doc();
		doc.transact(() => {
			const subjectsMap = doc.getMap(GraphDocField.Subjects) as Y.Map<unknown>;
			subjectsMap.set("A", new Y.Map());
			subjectsMap.set("B", new Y.Map());
			const edgesArr = doc.getArray(GraphDocField.Edges) as Y.Array<Y.Map<unknown>>;
			const emap = new Y.Map<unknown>();
			emap.set("from", "A");
			emap.set("to", "B");
			emap.set("direction", "garbage");
			emap.set("match", "garbage");
			emap.set("linkTypes", new Y.Array());
			const hopsArr = new Y.Array<number>();
			hopsArr.push([1, 1]);
			emap.set("hops", hopsArr);
			edgesArr.push([emap]);
		});

		const decoded = decodePatternFromDoc(doc);
		expect(decoded.edges).toHaveLength(1);
		expect(decoded.edges[0]?.direction).toBe(EdgeDirection.Out);
		expect(decoded.edges[0]?.match).toBe(EdgeMatch.Required);
	});

	it("a missing primarySubject falls back to the first subject name in the map", () => {
		const doc = new Y.Doc();
		encodePatternIntoDoc(doc, trivialPattern());
		// Wipe the primarySubject field; subjects still has S1.
		doc.getMap("graphMeta").delete(GraphDocField.PrimarySubject);

		const decoded = decodePatternFromDoc(doc);
		expect(decoded.primarySubject).toBe("S1");
	});
});
