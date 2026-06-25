/**
 * Pure, immutable mutation helpers for `GraphPattern` plus vault
 * type/link enumeration for the pattern editor's pickers.
 *
 * The editor never mutates `state.pattern` in place — every helper
 * returns a fresh pattern so `reconcileScene` + persistence see a clean
 * value and the change is trivially undoable later. Caps from
 * `types/pattern.ts` are enforced here (the UI also disables the add
 * affordances, but the helper is the authority).
 *
 * Matching/compilation lives in `match-pattern.ts`; this module only
 * shapes the pattern the user is editing.
 */

import {
	type EdgeConstraint,
	EdgeDirection,
	EdgeMatch,
	type GraphPattern,
	type Hops,
	PATTERN_MAX_EDGES,
	PATTERN_MAX_HOPS,
	PATTERN_MAX_SUBJECTS,
	type Subject,
	SubjectKind,
} from "../types/pattern";
import type { InMemoryGraph } from "./in-memory-graph";
import { validatePattern } from "./pattern-validate";

/** A subject with no type constraint binds every entity ("any type").
 *  `validatePattern` surfaces that as an advisory — it's intentional for
 *  the default "All entities" pattern, not an error. */
export function makeSubject(displayName: string, types: string[] = []): Subject {
	return {
		kind: SubjectKind.Entity,
		types,
		where: null,
		displayName,
		color: null,
		icon: null,
		limit: null,
	};
}

/** The default pattern when nothing is configured: one subject, any
 *  type, no edges — i.e. "show the whole vault". Replaces the old
 *  hardcoded `VAULT_PRESETS[0]`. */
export function defaultPattern(): GraphPattern {
	return {
		subjects: { S1: makeSubject("All entities") },
		edges: [],
		primarySubject: "S1",
	};
}

/** Next free `S<n>` binding key not already used in the pattern. */
function nextSubjectKey(pattern: GraphPattern): string {
	for (let n = 1; ; n += 1) {
		const key = `S${n}`;
		if (!(key in pattern.subjects)) return key;
	}
}

export function subjectCount(pattern: GraphPattern): number {
	return Object.keys(pattern.subjects).length;
}

/** The binding key the "Show" front-door lens edits — the pattern's primary
 *  subject, falling back to the first subject so the toggles always target a
 *  real subject even if `primarySubject` drifted out of `subjects`. Empty
 *  string only when the pattern has no subjects at all (never, by invariant). */
export function primarySubjectKey(pattern: GraphPattern): string {
	if (pattern.primarySubject in pattern.subjects) return pattern.primarySubject;
	return Object.keys(pattern.subjects)[0] ?? "";
}

export function canAddSubject(pattern: GraphPattern): boolean {
	return subjectCount(pattern) < PATTERN_MAX_SUBJECTS;
}

export function canAddEdge(pattern: GraphPattern): boolean {
	return pattern.edges.length < PATTERN_MAX_EDGES && subjectCount(pattern) >= 1;
}

export function addSubject(pattern: GraphPattern): GraphPattern {
	if (!canAddSubject(pattern)) return pattern;
	const key = nextSubjectKey(pattern);
	const n = subjectCount(pattern) + 1;
	return {
		...pattern,
		subjects: { ...pattern.subjects, [key]: makeSubject(`Subject ${n}`) },
	};
}

/** Remove a subject and any edge that referenced it. No-op when it would
 *  empty the pattern — a pattern always keeps at least one subject so the
 *  graph never goes blank from an editor click. */
export function removeSubject(pattern: GraphPattern, key: string): GraphPattern {
	if (!(key in pattern.subjects) || subjectCount(pattern) <= 1) return pattern;
	const subjects: Record<string, Subject> = {};
	for (const [k, v] of Object.entries(pattern.subjects)) {
		if (k !== key) subjects[k] = v;
	}
	const edges = pattern.edges.filter((e) => e.from !== key && e.to !== key);
	const primarySubject =
		pattern.primarySubject === key ? (Object.keys(subjects)[0] ?? "") : pattern.primarySubject;
	return { subjects, edges, primarySubject };
}

export function updateSubject(
	pattern: GraphPattern,
	key: string,
	patch: Partial<Subject>,
): GraphPattern {
	const current = pattern.subjects[key];
	if (!current) return pattern;
	return {
		...pattern,
		subjects: { ...pattern.subjects, [key]: { ...current, ...patch } },
	};
}

/** Add an edge between the first two subjects (or a self-edge when only
 *  one exists — the user retargets it immediately in the row). */
export function addEdge(pattern: GraphPattern): GraphPattern {
	if (!canAddEdge(pattern)) return pattern;
	const keys = Object.keys(pattern.subjects);
	const from = keys[0] ?? "";
	const to = keys[1] ?? from;
	const edge: EdgeConstraint = {
		from,
		to,
		linkTypes: [],
		direction: EdgeDirection.Out,
		match: EdgeMatch.Required,
		hops: [1, 1],
	};
	return { ...pattern, edges: [...pattern.edges, edge] };
}

export function removeEdge(pattern: GraphPattern, index: number): GraphPattern {
	if (index < 0 || index >= pattern.edges.length) return pattern;
	return { ...pattern, edges: pattern.edges.filter((_, i) => i !== index) };
}

export function updateEdge(
	pattern: GraphPattern,
	index: number,
	patch: Partial<EdgeConstraint>,
): GraphPattern {
	const current = pattern.edges[index];
	if (!current) return pattern;
	const edges = pattern.edges.slice();
	edges[index] = { ...current, ...patch };
	return { ...pattern, edges };
}

export type TypeOption = { type: string; count: number };

function tally(values: Iterable<string>): TypeOption[] {
	const counts = new Map<string, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()]
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** Distinct entity types present in the vault snapshot (deleted excluded),
 *  most-common first — the Subject editor's type picker reads this so the
 *  user only ever picks types that actually exist. */
export function availableEntityTypes(db: InMemoryGraph): TypeOption[] {
	return tally(
		(function* () {
			for (const e of db.entities) if (e.deletedAt === null) yield e.type;
		})(),
	);
}

/** Distinct link types present in the vault snapshot (deleted excluded). */
export function availableLinkTypes(db: InMemoryGraph): TypeOption[] {
	return tally(
		(function* () {
			for (const l of db.links) if (l.deletedAt === null) yield l.linkType;
		})(),
	);
}

/** Codes `validatePattern` raises that are *advisory* (intentional but
 *  expensive), not structural — a persisted/loaded pattern with only
 *  these is still safe to render. */
const ADVISORY_CODES = new Set(["subject-empty-types", "edge-empty-link-types"]);

/** Gate for untrusted patterns coming back from storage: must be a
 *  plausibly-shaped object and free of *structural* validation issues
 *  (unknown subject in an edge, inverted hops, no subjects, …). Advisory
 *  empty-type issues are tolerated — they're the default pattern's normal
 *  state. Anything malformed falls back to `defaultPattern()`. */
export function isUsablePattern(value: unknown): value is GraphPattern {
	if (typeof value !== "object" || value === null) return false;
	const p = value as Partial<GraphPattern>;
	if (typeof p.subjects !== "object" || p.subjects === null) return false;
	if (!Array.isArray(p.edges)) return false;
	if (typeof p.primarySubject !== "string") return false;
	const result = validatePattern(value as GraphPattern);
	if (result.ok) return true;
	return result.issues.every((i) => ADVISORY_CODES.has(i.code));
}

/** Human label for a type/link URL: `io.brainstorm.notes/Note/v1` →
 *  `Note`. Mirrors the existing sidebar convention so labels stay
 *  consistent across the app. Falls back to the raw URL. */
export function typeShortLabel(typeUrl: string): string {
	return typeUrl.split("/").slice(-2, -1)[0] ?? typeUrl;
}

/* ── Hop windows (9.13.4) ───────────────────────────────────────────────── */

/** Curated hop windows the edge editor offers. `[1,1]` = a direct link;
 *  the rest reach through intermediates up to `PATTERN_MAX_HOPS`. */
export const HOP_WINDOW_PRESETS: readonly Hops[] = [
	[1, 1],
	[1, 2],
	[1, 3],
	[1, PATTERN_MAX_HOPS],
	[2, PATTERN_MAX_HOPS],
];

/** Stable select-option key for a window. */
export function hopsKey(hops: Hops): string {
	return `${hops[0]}-${hops[1]}`;
}

/** Parse a select-option key back to a window; junk / out-of-range → null
 *  (the change handler then leaves the edge untouched). */
export function parseHopsKey(key: string): Hops | null {
	const parts = key.split("-");
	if (parts.length !== 2) return null;
	const min = Number(parts[0]);
	const max = Number(parts[1]);
	if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
	if (min < 1 || min > max || max > PATTERN_MAX_HOPS) return null;
	return [min, max];
}

/** The windows the select lists: the presets, plus the edge's current
 *  window when it isn't a preset (a persisted custom window must keep
 *  rendering as itself, not silently snap to a preset). */
export function hopsOptionsFor(current: Hops): readonly Hops[] {
	const has = HOP_WINDOW_PRESETS.some((preset) => hopsKey(preset) === hopsKey(current));
	return has ? HOP_WINDOW_PRESETS : [...HOP_WINDOW_PRESETS, current];
}
