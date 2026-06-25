/**
 * Pure pattern matcher over an in-memory graph. Mirrors the SQL compiler's
 * semantics from `packages/shell/src/main/entities/pattern-compiler.ts` so
 * the same `GraphPattern` produces the same matches under both engines.
 *
 * The matcher is what the demo + tests use; the SQL compiler is what the
 * entities service uses when it lands (Stage 9.3). Both must agree on:
 *   - Subject types + property predicates.
 *   - Required / Optional / Forbidden edge matches.
 *   - In / Out / Both directions.
 *   - Multi-hop windows (9.13.4): an edge with `hops [min,max]`, max > 1,
 *     is satisfied when a path of length within the window connects the
 *     pair over the permitted link types/orientation — mirroring the SQL
 *     compiler's bounded recursive CTE exactly (Required joins, Forbidden
 *     NOT-EXISTS, Optional multi-hop is a documented no-op, and no single
 *     link row is exposed).
 *   - Distinctness enforcement for same-type subjects.
 *
 * Performance: this is O(|entities|^|subjects| * |edges|). Fine for the
 * demo (≤50 entities); tests stay well under that. For the real renderer
 * the SQL compiler is the path.
 */

import {
	type EdgeConstraint,
	EdgeDirection,
	EdgeMatch,
	type GraphPattern,
	type Subject,
} from "../types/pattern";
import type { PropertyPredicate } from "../types/predicate";
import type { EntityRow, InMemoryGraph, LinkRow } from "./in-memory-graph";

export type Binding = Record<string, string>; // subjectName → entityId

export type Match = {
	binding: Binding;
	/** Edge-index → resolved link row id. null for satisfied Optional edges
	 *  that didn't bind, and absent (`undefined`) for Forbidden edges. */
	edgeLinkIds: Record<number, string | null>;
};

export type MatchResult = {
	matches: Match[];
	/** Aggregated visible-node set across all matches: subjectName → set of entityIds. */
	nodesBySubject: Record<string, Set<string>>;
	/** Aggregated visible-link set across all matches. */
	links: Set<string>;
};

export type MatchOptions = {
	distinctSubjects?: boolean;
	includeDeleted?: boolean;
};

export function matchPattern(
	pattern: GraphPattern,
	db: InMemoryGraph,
	options: MatchOptions = {},
): MatchResult {
	const distinctSubjects = options.distinctSubjects ?? true;
	const includeDeleted = options.includeDeleted ?? false;

	const subjectNames = Object.keys(pattern.subjects);
	const candidates = candidatesPerSubject(pattern, db, includeDeleted);
	const linkIndex = indexLinks(db, includeDeleted);

	const matches: Match[] = [];
	const nodesBySubject: Record<string, Set<string>> = Object.fromEntries(
		subjectNames.map((name) => [name, new Set<string>()]),
	);
	const visibleLinks = new Set<string>();

	enumerate(subjectNames, candidates, {}, (binding) => {
		if (distinctSubjects && !satisfiesDistinct(pattern, binding)) return;
		const edgeBindings = bindEdges(pattern.edges, binding, linkIndex);
		if (!edgeBindings) return;

		matches.push({ binding, edgeLinkIds: edgeBindings });
		for (const [name, entityId] of Object.entries(binding)) {
			nodesBySubject[name]?.add(entityId);
		}
		for (const linkId of Object.values(edgeBindings)) {
			if (linkId) visibleLinks.add(linkId);
		}
	});

	return { matches, nodesBySubject, links: visibleLinks };
}

/** True when `pattern` matches zero nodes despite a non-empty graph — the
 *  signature of a stale *restored* pattern whose type / link constraints point
 *  at types that no longer exist in the vault (a migrated or removed type URL).
 *  Such a pattern leaves the canvas permanently blank AND the absent type has
 *  no SHOW-filter toggle, so the user can't clear the constraint themselves —
 *  callers fall back to the show-everything default rather than a dead graph. */
export function isStaleEmptyPattern(pattern: GraphPattern, db: InMemoryGraph): boolean {
	if (db.entities.length === 0) return false;
	const result = matchPattern(pattern, db);
	for (const set of Object.values(result.nodesBySubject)) {
		if (set.size > 0) return false;
	}
	return true;
}

/* ── Candidate enumeration ──────────────────────────────────────────────── */

function candidatesPerSubject(
	pattern: GraphPattern,
	db: InMemoryGraph,
	includeDeleted: boolean,
): Record<string, EntityRow[]> {
	const out: Record<string, EntityRow[]> = {};
	for (const [name, subject] of Object.entries(pattern.subjects)) {
		out[name] = db.entities.filter((e) => entityMatchesSubject(e, subject, includeDeleted));
	}
	return out;
}

function entityMatchesSubject(
	entity: EntityRow,
	subject: Subject,
	includeDeleted: boolean,
): boolean {
	if (!includeDeleted && entity.deletedAt !== null) return false;
	if (subject.types.length > 0 && !subject.types.includes(entity.type)) return false;
	if (subject.where && !evaluatePredicate(subject.where, entity)) return false;
	return true;
}

function enumerate(
	subjectNames: string[],
	candidates: Record<string, EntityRow[]>,
	current: Binding,
	emit: (binding: Binding) => void,
): void {
	if (Object.keys(current).length === subjectNames.length) {
		emit({ ...current });
		return;
	}
	const next = subjectNames[Object.keys(current).length];
	if (!next) return;
	const list = candidates[next] ?? [];
	for (const candidate of list) {
		current[next] = candidate.id;
		enumerate(subjectNames, candidates, current, emit);
		delete current[next];
	}
}

/* ── Distinctness ───────────────────────────────────────────────────────── */

function satisfiesDistinct(pattern: GraphPattern, binding: Binding): boolean {
	const names = Object.keys(pattern.subjects);
	for (let i = 0; i < names.length; i += 1) {
		for (let j = i + 1; j < names.length; j += 1) {
			const a = names[i];
			const b = names[j];
			if (!a || !b) continue;
			const subjectA = pattern.subjects[a];
			const subjectB = pattern.subjects[b];
			if (!subjectA || !subjectB) continue;
			if (!typesIntersect(subjectA.types, subjectB.types)) continue;
			if (binding[a] === binding[b]) return false;
		}
	}
	return true;
}

function typesIntersect(a: string[], b: string[]): boolean {
	if (a.length === 0 || b.length === 0) return true;
	const set = new Set(a);
	for (const t of b) if (set.has(t)) return true;
	return false;
}

/* ── Edge binding ───────────────────────────────────────────────────────── */

type LinkIndex = {
	bySource: Map<string, LinkRow[]>;
	byDest: Map<string, LinkRow[]>;
};

function indexLinks(db: InMemoryGraph, includeDeleted: boolean): LinkIndex {
	const bySource = new Map<string, LinkRow[]>();
	const byDest = new Map<string, LinkRow[]>();
	for (const link of db.links) {
		if (!includeDeleted && link.deletedAt !== null) continue;
		push(bySource, link.sourceEntityId, link);
		push(byDest, link.destEntityId, link);
	}
	return { bySource, byDest };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

function bindEdges(
	edges: EdgeConstraint[],
	binding: Binding,
	linkIndex: LinkIndex,
): Record<number, string | null> | null {
	const result: Record<number, string | null> = {};
	for (let i = 0; i < edges.length; i += 1) {
		const edge = edges[i];
		if (!edge) continue;
		const fromId = binding[edge.from];
		const toId = binding[edge.to];
		if (!fromId || !toId) return null;

		const [, maxHops] = edge.hops;
		if (maxHops > 1) {
			// Multi-hop window (9.13.4) — mirrors the SQL CTE: Optional is a
			// no-op, Required needs a path in the window, Forbidden needs its
			// absence. No single link row binds either way.
			if (edge.match === EdgeMatch.Optional) {
				result[i] = null;
				continue;
			}
			const connected = reachableWithinWindow(edge, fromId, toId, linkIndex);
			if (edge.match === EdgeMatch.Required) {
				if (!connected) return null;
				result[i] = null;
			} else if (connected) {
				return null;
			}
			continue;
		}

		const link = findMatchingLink(edge, fromId, toId, linkIndex);

		if (edge.match === EdgeMatch.Required) {
			if (!link) return null;
			result[i] = link.id;
		} else if (edge.match === EdgeMatch.Optional) {
			result[i] = link ? link.id : null;
		} else {
			// Forbidden — must NOT exist.
			if (link) return null;
			// No row column for Forbidden.
		}
	}
	return result;
}

/**
 * Is there a path `from → to` whose length lies in the edge's hop window,
 * following only the edge's link types in its permitted orientation?
 * BFS over `(node, depth)` states (the CTE's UNION-dedupe equivalent), so
 * cyclic structures terminate at the depth bound. `In` walks the Out
 * orientation from `to` to `from` — exactly how the compiler consumes the
 * Out-shaped CTE with swapped join sides.
 */
function reachableWithinWindow(
	edge: EdgeConstraint,
	fromId: string,
	toId: string,
	linkIndex: LinkIndex,
): boolean {
	const [minHops, maxHops] = edge.hops;
	const linkTypeSet = new Set(edge.linkTypes);
	const start = edge.direction === EdgeDirection.In ? toId : fromId;
	const target = edge.direction === EdgeDirection.In ? fromId : toId;
	const followBoth = edge.direction === EdgeDirection.Both;

	const seen = new Set<string>([`${start}@0`]);
	let frontier: string[] = [start];
	for (let depth = 1; depth <= maxHops && frontier.length > 0; depth += 1) {
		const next: string[] = [];
		const visit = (node: string): void => {
			const key = `${node}@${depth}`;
			if (seen.has(key)) return;
			seen.add(key);
			next.push(node);
		};
		for (const node of frontier) {
			for (const link of linkIndex.bySource.get(node) ?? []) {
				if (linkTypeSet.has(link.linkType)) visit(link.destEntityId);
			}
			if (followBoth) {
				for (const link of linkIndex.byDest.get(node) ?? []) {
					if (linkTypeSet.has(link.linkType)) visit(link.sourceEntityId);
				}
			}
		}
		if (depth >= minHops && next.includes(target)) return true;
		frontier = next;
	}
	return false;
}

function findMatchingLink(
	edge: EdgeConstraint,
	fromId: string,
	toId: string,
	linkIndex: LinkIndex,
): LinkRow | null {
	const linkTypeSet = new Set(edge.linkTypes);
	const candidates = linkIndex.bySource.get(fromId) ?? [];
	for (const link of candidates) {
		if (!linkTypeSet.has(link.linkType)) continue;
		if (linkMatchesDirection(edge.direction, link, fromId, toId)) return link;
	}
	if (edge.direction === EdgeDirection.In || edge.direction === EdgeDirection.Both) {
		const inboundCandidates = linkIndex.byDest.get(fromId) ?? [];
		for (const link of inboundCandidates) {
			if (!linkTypeSet.has(link.linkType)) continue;
			if (linkMatchesDirection(edge.direction, link, fromId, toId)) return link;
		}
	}
	return null;
}

function linkMatchesDirection(
	direction: EdgeDirection,
	link: LinkRow,
	fromId: string,
	toId: string,
): boolean {
	switch (direction) {
		case EdgeDirection.Out:
			return link.sourceEntityId === fromId && link.destEntityId === toId;
		case EdgeDirection.In:
			return link.sourceEntityId === toId && link.destEntityId === fromId;
		case EdgeDirection.Both:
			return (
				(link.sourceEntityId === fromId && link.destEntityId === toId) ||
				(link.sourceEntityId === toId && link.destEntityId === fromId)
			);
	}
}

/* ── Property predicates ────────────────────────────────────────────────── */

function evaluatePredicate(predicate: PropertyPredicate, entity: EntityRow): boolean {
	const op = firstKey(predicate);
	switch (op) {
		case "$and": {
			const children = (predicate as { $and: PropertyPredicate[] }).$and;
			return children.every((c) => evaluatePredicate(c, entity));
		}
		case "$or": {
			const children = (predicate as { $or: PropertyPredicate[] }).$or;
			return children.some((c) => evaluatePredicate(c, entity));
		}
		case "$not": {
			return !evaluatePredicate((predicate as { $not: PropertyPredicate }).$not, entity);
		}
		default:
			return evaluateLeaf(op, predicate, entity);
	}
}

function evaluateLeaf(op: string, predicate: PropertyPredicate, entity: EntityRow): boolean {
	const body = (predicate as Record<string, unknown>)[op];
	if (!body || typeof body !== "object") return false;
	for (const [path, expected] of Object.entries(body)) {
		const actual = readPath(entity.properties, path);
		if (!leafMatches(op, actual, expected)) return false;
	}
	return true;
}

function leafMatches(op: string, actual: unknown, expected: unknown): boolean {
	switch (op) {
		case "$eq":
			return actual === expected;
		case "$neq":
			return actual !== expected;
		case "$gt":
			return typeof actual === "number" && typeof expected === "number" && actual > expected;
		case "$lt":
			return typeof actual === "number" && typeof expected === "number" && actual < expected;
		case "$gte":
			return typeof actual === "number" && typeof expected === "number" && actual >= expected;
		case "$lte":
			return typeof actual === "number" && typeof expected === "number" && actual <= expected;
		case "$contains":
			return typeof actual === "string" && actual.includes(String(expected));
		case "$notContains":
			return !(typeof actual === "string" && actual.includes(String(expected)));
		case "$like": {
			if (typeof actual !== "string") return false;
			return likeMatch(actual, String(expected));
		}
		case "$notLike":
			return !(typeof actual === "string" && likeMatch(actual, String(expected)));
		case "$in":
			return Array.isArray(expected) && expected.includes(actual as never);
		case "$notIn":
			return Array.isArray(expected) && !expected.includes(actual as never);
		case "$exists":
			return actual !== undefined && actual !== null;
		case "$empty":
			return (
				actual === null ||
				actual === undefined ||
				actual === "" ||
				(Array.isArray(actual) && actual.length === 0)
			);
		default:
			return false;
	}
}

function likeMatch(value: string, pattern: string): boolean {
	// SQL LIKE: % matches any sequence, _ matches one char. Case-insensitive.
	const regex = new RegExp(
		`^${pattern
			.split("")
			.map((c) => {
				if (c === "%") return ".*";
				if (c === "_") return ".";
				return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			})
			.join("")}$`,
		"i",
	);
	return regex.test(value);
}

function readPath(properties: Record<string, unknown>, path: string): unknown {
	const segments = path.split(".").filter(Boolean);
	let current: unknown = properties;
	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function firstKey(obj: object): string {
	for (const key in obj) return key;
	return "";
}
