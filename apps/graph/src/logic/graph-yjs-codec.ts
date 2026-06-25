/**
 * Y.Doc ⇄ `GraphPattern` codec (9.13.2).
 *
 * Implements the persisted shape of `brainstorm/Graph/v1` per the resolved
 * OQ-GR-1 :
 *
 *   - `subjects` → `Y.Map<subjectName, Y.Map>`; each subject map carries
 *     `kind` (string), `types` (`Y.Array<string>`), `where` (JSON value —
 *     predicates are edited atomically, not field-merged), `displayName`
 *     (string), and the graph-app-specific `color`/`icon`/`limit` (small
 *     scalars).
 *   - `edges` → `Y.Array<Y.Map>`, one map per `EdgeConstraint`
 *     (`from`, `to`, `linkTypes: Y.Array<string>`, `direction`, `match`,
 *     `hops: Y.Array<number>` length-2).
 *   - `primarySubject` → top-level string on the Graph Y.Doc root.
 *
 * 9.13.2 scope: a full structural codec (every shape OQ-GR-1 specifies)
 * with **explicit trivial-case test coverage**. "Trivial" = single subject,
 * no edges, no `where`. Richer patterns round-trip cleanly too — the
 * projection is well-defined and writing the partial codec would just
 * create churn at 9.13.6 (Y.Doc-position store), so we land the full
 * structural projection now. The compiler still reads the flat decoded
 * `GraphPattern`; the Y.Doc/codec lives only at the persistence boundary.
 *
 * Concurrent edits: subject reorders and concurrent edge additions on two
 * devices merge cleanly because the projection is structural. `where`
 * stays opaque JSON (a half-merged predicate is an invalid expression
 * tree, and predicates are not a concurrent-edit hotspot — OQ-GR-1).
 *
 * The codec is pure: every write happens inside a single `doc.transact`
 * so consumers observe one merged update. Reads are tolerant — a missing
 * field falls back to the matching `defaultPattern()` value rather than
 * throwing, so a legacy doc opens with sensible defaults and the user
 * can resave to upgrade.
 */

import * as Y from "yjs";
import type { Icon } from "../types/icon";
import {
	type EdgeConstraint,
	EdgeDirection,
	EdgeMatch,
	type GraphPattern,
	type Hops,
	type Subject,
	SubjectKind,
} from "../types/pattern";
import type { PropertyPredicate } from "../types/predicate";

/** Top-level Y.Doc field names on a `Graph/v1` doc. Centralised so the
 *  shell-side compiler (when it reads doc state at 9.13.6+) can target
 *  the same keys without re-inventing them. */
export enum GraphDocField {
	Subjects = "subjects",
	Edges = "edges",
	PrimarySubject = "primarySubject",
}

/** Inner field names on a subject's Y.Map. Subject extras
 *  (`color`/`icon`/`limit`) sit beside the OQ-GR-1 canonical four so the
 *  graph-app-specific rendering data survives the round-trip. */
enum SubjectField {
	Kind = "kind",
	Types = "types",
	Where = "where",
	DisplayName = "displayName",
	Color = "color",
	Icon = "icon",
	Limit = "limit",
}

/** Inner field names on an edge's Y.Map. */
enum EdgeField {
	From = "from",
	To = "to",
	LinkTypes = "linkTypes",
	Direction = "direction",
	Match = "match",
	Hops = "hops",
}

/* ── Encode ─────────────────────────────────────────────────────────────── */

/** Project `pattern` onto `doc` per the structural shape resolved in
 *  OQ-GR-1. Existing doc state is **replaced** atomically inside a single
 *  transaction so observers see one update. Safe to call on a brand-new
 *  doc or one that already carries an older pattern. */
export function encodePatternIntoDoc(doc: Y.Doc, pattern: GraphPattern): void {
	doc.transact(() => {
		// primarySubject — a plain scalar on the doc root's metadata map.
		// OQ-GR-1 names it as a top-level `Y.Text`/string field; a string in
		// a root Y.Map is the simplest, smallest, conflict-friendly form.
		const root = rootMeta(doc);
		root.set(GraphDocField.PrimarySubject, pattern.primarySubject);

		// subjects — Y.Map<name, Y.Map>.
		const subjectsMap = doc.getMap<Y.Map<unknown>>(GraphDocField.Subjects);
		// Drop any subjects no longer in the pattern.
		const wantedNames = new Set(Object.keys(pattern.subjects));
		for (const name of [...subjectsMap.keys()]) {
			if (!wantedNames.has(name)) subjectsMap.delete(name);
		}
		for (const [name, subject] of Object.entries(pattern.subjects)) {
			let smap = subjectsMap.get(name);
			if (!smap) {
				smap = new Y.Map();
				subjectsMap.set(name, smap);
			}
			writeSubjectInto(smap, subject);
		}

		// edges — Y.Array<Y.Map>. Replaced wholesale: the array is small
		// (≤32 entries hard cap) and the order is meaningful (renderer-side
		// stable iteration), so a wholesale replace + transact gives the
		// cleanest semantics for the trivial codec; finer-grained diffing
		// is a 9.13.6 codec-perf concern, not 9.13.2's.
		const edgesArr = doc.getArray<Y.Map<unknown>>(GraphDocField.Edges);
		edgesArr.delete(0, edgesArr.length);
		for (const edge of pattern.edges) {
			const emap = new Y.Map<unknown>();
			writeEdgeInto(emap, edge);
			edgesArr.push([emap]);
		}
	});
}

function writeSubjectInto(smap: Y.Map<unknown>, subject: Subject): void {
	smap.set(SubjectField.Kind, subject.kind);
	smap.set(SubjectField.DisplayName, subject.displayName);
	// types — Y.Array<string>. Replace in place so subscribers see one
	// targeted event per subject edit.
	let typesArr = smap.get(SubjectField.Types);
	if (!(typesArr instanceof Y.Array)) {
		typesArr = new Y.Array<string>();
		smap.set(SubjectField.Types, typesArr);
	}
	const t = typesArr as Y.Array<string>;
	t.delete(0, t.length);
	if (subject.types.length > 0) t.push([...subject.types]);

	// where — opaque JSON (null when absent). Encoding as a plain JS value
	// inside the Y.Map keeps it atomic, per OQ-GR-1.
	smap.set(SubjectField.Where, subject.where);

	// Extras — small scalars/objects; null when unset.
	smap.set(SubjectField.Color, subject.color);
	smap.set(SubjectField.Icon, subject.icon);
	smap.set(SubjectField.Limit, subject.limit);
}

function writeEdgeInto(emap: Y.Map<unknown>, edge: EdgeConstraint): void {
	emap.set(EdgeField.From, edge.from);
	emap.set(EdgeField.To, edge.to);
	emap.set(EdgeField.Direction, edge.direction);
	emap.set(EdgeField.Match, edge.match);

	const linkTypesArr = new Y.Array<string>();
	if (edge.linkTypes.length > 0) linkTypesArr.push([...edge.linkTypes]);
	emap.set(EdgeField.LinkTypes, linkTypesArr);

	const hopsArr = new Y.Array<number>();
	hopsArr.push([edge.hops[0], edge.hops[1]]);
	emap.set(EdgeField.Hops, hopsArr);
}

/* ── Decode ─────────────────────────────────────────────────────────────── */

/** Read the pattern from `doc`. Tolerant of missing fields — returns a
 *  pattern populated with the matching default value rather than throwing,
 *  so a fresh / legacy / partially-written doc still yields a usable
 *  pattern.
 *
 *  Returns the trivial "single S1, no edges" pattern when the doc carries
 *  no subjects at all (e.g. a brand-new Graph/v1 entity whose body hasn't
 *  been written yet). That mirrors `defaultPattern()` so the caller can
 *  treat "no body" and "empty body" identically. */
export function decodePatternFromDoc(doc: Y.Doc): GraphPattern {
	const root = rootMeta(doc);
	const primaryRaw = root.get(GraphDocField.PrimarySubject);
	const subjectsMap = doc.getMap<Y.Map<unknown>>(GraphDocField.Subjects);
	const edgesArr = doc.getArray<Y.Map<unknown>>(GraphDocField.Edges);

	const subjects: Record<string, Subject> = {};
	for (const [name, smap] of subjectsMap.entries()) {
		subjects[name] = readSubject(smap);
	}

	const edges: EdgeConstraint[] = [];
	for (let i = 0; i < edgesArr.length; i += 1) {
		const emap = edgesArr.get(i);
		const edge = readEdge(emap);
		if (edge) edges.push(edge);
	}

	const subjectNames = Object.keys(subjects);
	if (subjectNames.length === 0) {
		// Empty doc → trivial default. Mirrors `defaultPattern()` without
		// importing it (keeps the codec pure / no edge-case dependency).
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

	const primarySubject =
		typeof primaryRaw === "string" && primaryRaw in subjects
			? primaryRaw
			: (subjectNames[0] as string);

	return { subjects, edges, primarySubject };
}

function readSubject(smap: Y.Map<unknown>): Subject {
	// SubjectKind today has one variant (Entity); decode tolerantly so a
	// future variant doesn't crash an older reader — fall back to Entity.
	const displayName = stringOr(smap.get(SubjectField.DisplayName), "");
	const types = readStringArray(smap.get(SubjectField.Types));
	const where = readPredicate(smap.get(SubjectField.Where));
	const color = stringOrNull(smap.get(SubjectField.Color));
	const icon = readIcon(smap.get(SubjectField.Icon));
	const limit = numberOrNull(smap.get(SubjectField.Limit));
	return { kind: SubjectKind.Entity, types, where, displayName, color, icon, limit };
}

function readEdge(emap: Y.Map<unknown>): EdgeConstraint | null {
	const fromRaw = emap.get(EdgeField.From);
	const toRaw = emap.get(EdgeField.To);
	if (typeof fromRaw !== "string" || fromRaw === "") return null;
	if (typeof toRaw !== "string" || toRaw === "") return null;
	const linkTypes = readStringArray(emap.get(EdgeField.LinkTypes));
	const direction = readDirection(emap.get(EdgeField.Direction));
	const match = readMatch(emap.get(EdgeField.Match));
	const hops = readHops(emap.get(EdgeField.Hops));
	return { from: fromRaw, to: toRaw, linkTypes, direction, match, hops };
}

/* ── Field-level readers (tolerant) ─────────────────────────────────────── */

function rootMeta(doc: Y.Doc): Y.Map<unknown> {
	return doc.getMap<unknown>("graphMeta");
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
	if (value instanceof Y.Array) {
		const out: string[] = [];
		for (let i = 0; i < value.length; i += 1) {
			const v = value.get(i);
			if (typeof v === "string") out.push(v);
		}
		return out;
	}
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
	return [];
}

/** `where` is JSON-opaque per OQ-GR-1 — accept the value as-is when the
 *  shape passes a structural sniff. We don't validate the predicate tree
 *  here (the editor / matcher do); a corrupt / non-object value reads as
 *  null so the subject stays a type-only match. */
function readPredicate(value: unknown): PropertyPredicate | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object") return null;
	return value as PropertyPredicate;
}

function readIcon(value: unknown): Icon | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object") return null;
	return value as Icon;
}

function readDirection(value: unknown): EdgeDirection {
	switch (value) {
		case EdgeDirection.In:
			return EdgeDirection.In;
		case EdgeDirection.Both:
			return EdgeDirection.Both;
		default:
			return EdgeDirection.Out;
	}
}

function readMatch(value: unknown): EdgeMatch {
	switch (value) {
		case EdgeMatch.Optional:
			return EdgeMatch.Optional;
		case EdgeMatch.Forbidden:
			return EdgeMatch.Forbidden;
		default:
			return EdgeMatch.Required;
	}
}

function readHops(value: unknown): Hops {
	let lo = 1;
	let hi = 1;
	if (value instanceof Y.Array && value.length >= 2) {
		const a = value.get(0);
		const b = value.get(1);
		if (typeof a === "number" && Number.isFinite(a)) lo = a;
		if (typeof b === "number" && Number.isFinite(b)) hi = b;
	} else if (Array.isArray(value) && value.length >= 2) {
		if (typeof value[0] === "number") lo = value[0];
		if (typeof value[1] === "number") hi = value[1];
	}
	if (lo < 0) lo = 0;
	if (hi < lo) hi = lo;
	return [lo, hi] as const;
}
