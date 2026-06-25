/**
 * Pattern compiler — turns a `GraphPattern` (named subjects + typed edge
 * constraints) into a parametrized SQL plan against `entities.db` per
 *  §Schema.
 *
 * Lives in the shell because the entities service owns SQL compilation
 * (apps never write SQL — they call `entities.subscribe({graphPattern})`).
 *
 * Scope:
 *   - Single-hop edges (hops = [1, 1]) compile to plain link JOINs.
 *   - Multi-hop edges (max > 1, Stage 9.13.4) compile to a bounded
 *     recursive CTE per edge (`H_<i>(src, dst, depth)`): seeds are the
 *     direction-permitted single links, the recursive step extends by one
 *     link, `depth < max` bounds recursion (UNION dedupes, so cycles
 *     can't spin), and the join site applies `depth >= min`. An Optional
 *     multi-hop edge compiles to NO constraint — optionality only ever
 *     mattered for exposing the single link row to paint, and a multi-hop
 *     edge has no single row to expose.
 *   - Required / Optional / Forbidden edge match modes.
 *   - In / Out / Both directions (In reuses the Out CTE with the join
 *     sides swapped; Both seeds + steps both orientations).
 *   - The full property-predicate set from packages/shell/src/main/entities/pattern.ts.
 *   - Distinct-subject enforcement by default (OQ-GR-8 tentative).
 *   - Cost-cap guard: rejects patterns whose declared shape would exceed
 *     PATTERN_MAX_SUBJECTS / PATTERN_MAX_EDGES / PATTERN_MAX_HOPS.
 *
 * The output is a parametrized SELECT + row-shape descriptor; the entities
 * service runs it through the shared SQLite abstraction (sqlite.ts).
 */

import {
	type EdgeConstraint,
	EdgeDirection,
	EdgeMatch,
	type GraphPattern,
	PATTERN_MAX_EDGES,
	PATTERN_MAX_HOPS,
	PATTERN_MAX_SUBJECTS,
	type PropertyPath,
	type PropertyPredicate,
	type ScalarValue,
	type Subject,
} from "./pattern";

/* ── Public surface ─────────────────────────────────────────────────────── */

/** Hard ceiling on rows a single multi-hop recursive CTE may materialize.
 *  A recursive CTE is an optimization fence: the subject predicates never
 *  push down into it, so it seeds from the ENTIRE links table for the edge's
 *  link types and a dense link graph can fan out to ~N²×maxHops `(src, dst,
 *  depth)` rows before the join site ever filters by the subject candidate
 *  sets. The cost-cap preflight is structural and can under-model that
 *  explosion, so each CTE carries its own `LIMIT` as the real, data-dependent
 *  protection — a pathological link graph can't pin the main process even if
 *  the estimate let the query through. The ceiling is generous (legitimate
 *  multi-hop reachability over a real vault stays well under it) and the
 *  estimate also folds in a matching breadth term so the two agree. */
export const MULTI_HOP_CTE_ROW_LIMIT = 200_000;

export type SqlParam = ScalarValue | number;

export type RowShape = {
	/** Subject-name → column-name prefix, e.g. "A" → "A". Row columns are
	 *  `A_id`, `A_type`, `A_props`, `A_createdby`, `A_created`, `A_updated`. */
	subjects: Record<string, string>;
	/** Per-edge result column names, e.g. edge 0 (A→S) → "edge_0_id". */
	edges: Record<number, string | null>;
};

export type CompileOptions = {
	/** Default true. When true, distinct subjects of the same type are
	 *  enforced via `A.id != B.id` for every pair of subjects whose `types`
	 *  sets intersect. Toggle off for "allow self-binding" power-user mode. */
	distinctSubjects?: boolean;
	/** When true, drops `entities.deleted_at IS NULL` from the query — the
	 *  history scrubber needs to see deleted rows when scrubbing past the
	 *  deletion's `deleted_at`. Default false. */
	includeDeleted?: boolean;
};

export type CompileError =
	| { code: "no-subjects" }
	| { code: "too-many-subjects"; count: number; max: number }
	| { code: "too-many-edges"; count: number; max: number }
	| { code: "primary-subject-missing"; primarySubject: string }
	| { code: "unknown-subject"; subjectName: string; edgeIndex: number; side: "from" | "to" }
	| { code: "empty-link-types"; edgeIndex: number }
	| { code: "invalid-hops"; edgeIndex: number; min: number; max: number; maxAllowed: number }
	| { code: "invalid-property-path"; path: string };

/** Thrown from deep inside predicate compilation (`jsonExtractExpr`) when a
 *  property path segment fails the charset guard, and caught at the
 *  `compilePattern` boundary to surface as a structured `CompileError`.
 *  Internal — never escapes the compiler. */
class PatternCompileException extends Error {
	constructor(readonly compileError: CompileError) {
		super(compileError.code);
		this.name = "PatternCompileException";
	}
}

/** SECURITY: predicate paths are interpolated (not bound) into the SQLite
 *  JSON path string literal `'$.<segment>...'`, so a path segment containing
 *  a single quote would break out of the literal and inject arbitrary SQL
 *  against `entities.db` (which holds all vault data incl. wrapped per-entity
 *  DEKs). This is reachable from any app via `entities.queryPattern`. Each
 *  non-index segment must therefore match this charset (digit-only segments
 *  are handled separately as array indices). Mirrors `PROPERTY_KEY_RE` in
 *  `entities-repo.ts`, minus the dot (the compiler splits on `.` first). */
const PATH_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export type CompileResult =
	| {
			ok: true;
			sql: string;
			params: SqlParam[];
			rowShape: RowShape;
			distinctEnforced: boolean;
	  }
	| { ok: false; error: CompileError };

/* ── The compiler ───────────────────────────────────────────────────────── */

export function compilePattern(pattern: GraphPattern, options: CompileOptions = {}): CompileResult {
	const validation = preflight(pattern);
	if (validation) return { ok: false, error: validation };
	try {
		return compileChecked(pattern, options);
	} catch (error) {
		if (error instanceof PatternCompileException) return { ok: false, error: error.compileError };
		throw error;
	}
}

function compileChecked(pattern: GraphPattern, options: CompileOptions): CompileResult {
	const distinct = options.distinctSubjects ?? true;
	const subjectAlias = Object.fromEntries(
		Object.keys(pattern.subjects).map((name) => [name, sanitizeAlias(name)]),
	) as Record<string, string>;

	// Params MUST be assembled in the textual order their `?` placeholders
	// appear in the final SQL — SQLite binds positionally. The string is
	// `SELECT … FROM <subject joins><link joins, with link-type ?s> WHERE
	// <subject type/predicate ?s> AND <Forbidden NOT EXISTS ?s>`, so the
	// FROM-side (Required/Optional link types) binds before the WHERE-side
	// (subject types/predicates), which binds before the Forbidden
	// subqueries. A single shared array fed in subject-then-edge code
	// order put the subject params first while the SQL emitted the link
	// JOINs first — every executed pattern silently returned zero rows
	// (the prior tests only asserted on substrings / param-set membership,
	// never executed the SQL, so this shipped latent in 9.13.1.5).
	const cteParams: SqlParam[] = []; // recursive-CTE ?s (WITH clause — textually first)
	const fromParams: SqlParam[] = []; // Required/Optional link-type ?s (FROM order)
	const whereSubjectParams: SqlParam[] = []; // subject type/predicate ?s (WHERE order)
	const whereForbiddenParams: SqlParam[] = []; // Forbidden NOT EXISTS ?s (after subjects)
	const cteFragments: string[] = [];
	const selectFragments: string[] = [];
	const fromFragments: string[] = [];
	const whereFragments: string[] = [];
	const rowShape: RowShape = { subjects: { ...subjectAlias }, edges: {} };

	const subjectNames = Object.keys(pattern.subjects);
	subjectNames.forEach((name, index) => {
		const subject = pattern.subjects[name];
		if (!subject) return;
		const alias = subjectAlias[name] ?? sanitizeAlias(name);
		appendSubjectSelect(selectFragments, alias);

		if (index === 0) {
			fromFragments.push(`FROM entities ${alias}`);
		} else {
			fromFragments.push(`JOIN entities ${alias}`);
		}
		appendSubjectWhere(subject, alias, whereSubjectParams, whereFragments, options);
	});

	pattern.edges.forEach((edge, edgeIndex) => {
		const fromAlias = subjectAlias[edge.from];
		const toAlias = subjectAlias[edge.to];
		if (!fromAlias || !toAlias) return; // preflight should have caught this
		const [, maxHops] = edge.hops;
		if (maxHops > 1) {
			appendMultiHopEdge(
				edge,
				edgeIndex,
				fromAlias,
				toAlias,
				cteParams,
				fromParams,
				whereForbiddenParams,
				cteFragments,
				fromFragments,
				whereFragments,
				rowShape,
			);
		} else {
			appendEdge(
				edge,
				edgeIndex,
				fromAlias,
				toAlias,
				fromParams,
				whereForbiddenParams,
				selectFragments,
				fromFragments,
				whereFragments,
				rowShape,
			);
		}
	});

	if (distinct) {
		appendDistinctPairConstraints(pattern.subjects, subjectAlias, whereFragments);
	}

	const sql = [
		cteFragments.length > 0 ? `WITH RECURSIVE ${cteFragments.join(", ")}` : "",
		`SELECT ${selectFragments.join(", ")}`,
		fromFragments.join(" "),
		whereFragments.length > 0 ? `WHERE ${whereFragments.join(" AND ")}` : "",
	]
		.filter(Boolean)
		.join(" ");

	const params: SqlParam[] = [
		...cteParams,
		...fromParams,
		...whereSubjectParams,
		...whereForbiddenParams,
	];
	return { ok: true, sql, params, rowShape, distinctEnforced: distinct };
}

/* ── Internals ──────────────────────────────────────────────────────────── */

function preflight(pattern: GraphPattern): CompileError | null {
	const subjectNames = Object.keys(pattern.subjects);
	if (subjectNames.length === 0) return { code: "no-subjects" };
	if (subjectNames.length > PATTERN_MAX_SUBJECTS) {
		return {
			code: "too-many-subjects",
			count: subjectNames.length,
			max: PATTERN_MAX_SUBJECTS,
		};
	}
	if (pattern.edges.length > PATTERN_MAX_EDGES) {
		return { code: "too-many-edges", count: pattern.edges.length, max: PATTERN_MAX_EDGES };
	}
	if (!subjectNames.includes(pattern.primarySubject)) {
		return { code: "primary-subject-missing", primarySubject: pattern.primarySubject };
	}
	for (let i = 0; i < pattern.edges.length; i += 1) {
		const edge = pattern.edges[i];
		if (!edge) continue;
		if (!subjectNames.includes(edge.from)) {
			return { code: "unknown-subject", subjectName: edge.from, edgeIndex: i, side: "from" };
		}
		if (!subjectNames.includes(edge.to)) {
			return { code: "unknown-subject", subjectName: edge.to, edgeIndex: i, side: "to" };
		}
		if (edge.linkTypes.length === 0) {
			return { code: "empty-link-types", edgeIndex: i };
		}
		const [minHops, maxHops] = edge.hops;
		const hopsInvalid =
			!Number.isInteger(minHops) ||
			!Number.isInteger(maxHops) ||
			minHops < 1 ||
			minHops > maxHops ||
			maxHops > PATTERN_MAX_HOPS;
		if (hopsInvalid) {
			return {
				code: "invalid-hops",
				edgeIndex: i,
				min: minHops,
				max: maxHops,
				maxAllowed: PATTERN_MAX_HOPS,
			};
		}
	}
	return null;
}

function appendSubjectSelect(selectFragments: string[], alias: string): void {
	selectFragments.push(
		`${alias}.id AS ${alias}_id`,
		`${alias}.type AS ${alias}_type`,
		`${alias}.properties AS ${alias}_props`,
		`${alias}.created_by AS ${alias}_createdby`,
		`${alias}.created_at AS ${alias}_created`,
		`${alias}.updated_at AS ${alias}_updated`,
	);
}

function appendSubjectWhere(
	subject: Subject,
	alias: string,
	params: SqlParam[],
	whereFragments: string[],
	options: CompileOptions,
): void {
	if (subject.types.length > 0) {
		const placeholders = subject.types.map(() => "?").join(", ");
		whereFragments.push(`${alias}.type IN (${placeholders})`);
		params.push(...subject.types);
	}
	if (!options.includeDeleted) {
		whereFragments.push(`${alias}.deleted_at IS NULL`);
	}
	if (subject.where) {
		const predicateSql = compilePredicate(subject.where, alias, params);
		if (predicateSql) whereFragments.push(predicateSql);
	}
}

function appendEdge(
	edge: EdgeConstraint,
	edgeIndex: number,
	fromAlias: string,
	toAlias: string,
	fromParams: SqlParam[],
	whereForbiddenParams: SqlParam[],
	selectFragments: string[],
	fromFragments: string[],
	whereFragments: string[],
	rowShape: RowShape,
): void {
	const linkAlias = `L_${edgeIndex}`;
	const linkPlaceholders = edge.linkTypes.map(() => "?").join(", ");
	const directionClause = directionMatchClause(edge.direction, linkAlias, fromAlias, toAlias);

	const baseConditions = [
		directionClause,
		`${linkAlias}.link_type IN (${linkPlaceholders})`,
		`${linkAlias}.deleted_at IS NULL`,
	];

	if (edge.match === EdgeMatch.Required) {
		fromFragments.push(`JOIN links ${linkAlias} ON ${baseConditions.join(" AND ")}`);
		fromParams.push(...edge.linkTypes);
		appendEdgeSelect(selectFragments, linkAlias);
		rowShape.edges[edgeIndex] = `${linkAlias}_id`;
	} else if (edge.match === EdgeMatch.Optional) {
		fromFragments.push(`LEFT JOIN links ${linkAlias} ON ${baseConditions.join(" AND ")}`);
		fromParams.push(...edge.linkTypes);
		appendEdgeSelect(selectFragments, linkAlias);
		rowShape.edges[edgeIndex] = `${linkAlias}_id`;
	} else {
		// Forbidden — NOT EXISTS subquery; emits no row / no SELECT column.
		// Its placeholders sit after every subject WHERE clause in the SQL
		// text, so they bind from the dedicated Forbidden bucket.
		whereFragments.push(
			`NOT EXISTS (SELECT 1 FROM links ${linkAlias} WHERE ${baseConditions.join(" AND ")})`,
		);
		whereForbiddenParams.push(...edge.linkTypes);
		rowShape.edges[edgeIndex] = null;
	}
}

function appendEdgeSelect(selectFragments: string[], linkAlias: string): void {
	selectFragments.push(
		`${linkAlias}.id AS ${linkAlias}_id`,
		`${linkAlias}.source_entity_id AS ${linkAlias}_src`,
		`${linkAlias}.dest_entity_id AS ${linkAlias}_dst`,
		`${linkAlias}.link_type AS ${linkAlias}_ltype`,
		`${linkAlias}.created_at AS ${linkAlias}_lcreated`,
	);
}

/**
 * Multi-hop edge (9.13.4): one bounded recursive CTE per edge over the
 * permitted link types, joined (or NOT-EXISTS'd) between the two subject
 * aliases. `In` reuses the Out-shaped CTE with the join sides swapped;
 * `Both` seeds and steps both orientations (undirected reachability).
 * UNION (not UNION ALL) dedupes `(src, dst, depth)` rows so cyclic link
 * structures can't expand unboundedly; `depth < max` bounds recursion.
 * Multi-hop edges expose no link row (`rowShape.edges[i] = null`) — the
 * constraint binds the pair; painting reads the live links among matched
 * nodes as ever. An Optional multi-hop edge is a documented no-op.
 */
function appendMultiHopEdge(
	edge: EdgeConstraint,
	edgeIndex: number,
	fromAlias: string,
	toAlias: string,
	cteParams: SqlParam[],
	fromParams: SqlParam[],
	whereForbiddenParams: SqlParam[],
	cteFragments: string[],
	fromFragments: string[],
	whereFragments: string[],
	rowShape: RowShape,
): void {
	rowShape.edges[edgeIndex] = null;
	if (edge.match === EdgeMatch.Optional) return;

	const [minHops, maxHops] = edge.hops;
	const name = `H_${edgeIndex}`;
	const lt = edge.linkTypes.map(() => "?").join(", ");
	const seedOut = `SELECT source_entity_id, dest_entity_id, 1 FROM links WHERE link_type IN (${lt}) AND deleted_at IS NULL`;
	const seedIn = `SELECT dest_entity_id, source_entity_id, 1 FROM links WHERE link_type IN (${lt}) AND deleted_at IS NULL`;
	const stepOut = `SELECT h.src, l.dest_entity_id, h.depth + 1 FROM ${name} h JOIN links l ON l.source_entity_id = h.dst AND l.link_type IN (${lt}) AND l.deleted_at IS NULL WHERE h.depth < ?`;
	const stepIn = `SELECT h.src, l.source_entity_id, h.depth + 1 FROM ${name} h JOIN links l ON l.dest_entity_id = h.dst AND l.link_type IN (${lt}) AND l.deleted_at IS NULL WHERE h.depth < ?`;

	// Params must mirror the CTE's textual placeholder order exactly. The
	// trailing `LIMIT` (see MULTI_HOP_CTE_ROW_LIMIT) caps the materialized
	// intermediate: SQLite applies a `LIMIT` on a recursive compound to the
	// whole CTE, halting recursion once that many rows accrue — the real,
	// data-dependent guard against a dense link graph fanning out unboundedly
	// past the structural preflight. A trusted constant, interpolated (not
	// bound), so the cteParams positional discipline is unchanged.
	if (edge.direction === EdgeDirection.Both) {
		cteFragments.push(
			`${name}(src, dst, depth) AS (${seedOut} UNION ${seedIn} UNION ${stepOut} UNION ${stepIn} LIMIT ${MULTI_HOP_CTE_ROW_LIMIT})`,
		);
		cteParams.push(...edge.linkTypes, ...edge.linkTypes);
		cteParams.push(...edge.linkTypes, maxHops, ...edge.linkTypes, maxHops);
	} else {
		// In is the Out-shaped walk consumed with swapped join sides below.
		cteFragments.push(
			`${name}(src, dst, depth) AS (${seedOut} UNION ${stepOut} LIMIT ${MULTI_HOP_CTE_ROW_LIMIT})`,
		);
		cteParams.push(...edge.linkTypes, ...edge.linkTypes, maxHops);
	}

	const srcAlias = edge.direction === EdgeDirection.In ? toAlias : fromAlias;
	const dstAlias = edge.direction === EdgeDirection.In ? fromAlias : toAlias;
	const pairConditions = [`${name}.src = ${srcAlias}.id`, `${name}.dst = ${dstAlias}.id`];
	if (minHops > 1) pairConditions.push(`${name}.depth >= ?`);

	if (edge.match === EdgeMatch.Required) {
		fromFragments.push(`JOIN ${name} ON ${pairConditions.join(" AND ")}`);
		if (minHops > 1) fromParams.push(minHops);
	} else {
		// Forbidden: no pair within the hop window may exist.
		whereFragments.push(`NOT EXISTS (SELECT 1 FROM ${name} WHERE ${pairConditions.join(" AND ")})`);
		if (minHops > 1) whereForbiddenParams.push(minHops);
	}
}

function directionMatchClause(
	direction: EdgeDirection,
	linkAlias: string,
	fromAlias: string,
	toAlias: string,
): string {
	switch (direction) {
		case EdgeDirection.Out:
			return `${linkAlias}.source_entity_id = ${fromAlias}.id AND ${linkAlias}.dest_entity_id = ${toAlias}.id`;
		case EdgeDirection.In:
			return `${linkAlias}.source_entity_id = ${toAlias}.id AND ${linkAlias}.dest_entity_id = ${fromAlias}.id`;
		case EdgeDirection.Both:
			// Either direction: from→to or to→from. Symmetric edge match.
			return [
				`((${linkAlias}.source_entity_id = ${fromAlias}.id AND ${linkAlias}.dest_entity_id = ${toAlias}.id)`,
				`OR (${linkAlias}.source_entity_id = ${toAlias}.id AND ${linkAlias}.dest_entity_id = ${fromAlias}.id))`,
			].join(" ");
	}
}

function appendDistinctPairConstraints(
	subjects: GraphPattern["subjects"],
	subjectAlias: Record<string, string>,
	whereFragments: string[],
): void {
	const names = Object.keys(subjects);
	for (let i = 0; i < names.length; i += 1) {
		for (let j = i + 1; j < names.length; j += 1) {
			const a = names[i];
			const b = names[j];
			if (!a || !b) continue;
			const subjectA = subjects[a];
			const subjectB = subjects[b];
			if (!subjectA || !subjectB) continue;
			if (typesIntersect(subjectA.types, subjectB.types)) {
				whereFragments.push(`${subjectAlias[a]}.id != ${subjectAlias[b]}.id`);
			}
		}
	}
}

function typesIntersect(a: string[], b: string[]): boolean {
	if (a.length === 0 || b.length === 0) return true; // any-type intersects everything
	const setA = new Set(a);
	for (const t of b) if (setA.has(t)) return true;
	return false;
}

function sanitizeAlias(name: string): string {
	// SQL identifier: alphanumerics + underscore; first char non-digit.
	const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
	return /^[A-Za-z_]/.test(cleaned) ? cleaned : `s_${cleaned}`;
}

/* ── Property-predicate compiler ────────────────────────────────────────── */

function compilePredicate(predicate: PropertyPredicate, alias: string, params: SqlParam[]): string {
	const op = firstKey(predicate);
	switch (op) {
		case "$and":
		case "$or": {
			const children = (predicate as { $and?: PropertyPredicate[]; $or?: PropertyPredicate[] })[op];
			if (!children || children.length === 0) return "";
			const compiled = children.map((c) => compilePredicate(c, alias, params)).filter(Boolean);
			if (compiled.length === 0) return "";
			const joiner = op === "$and" ? " AND " : " OR ";
			return `(${compiled.join(joiner)})`;
		}
		case "$not": {
			const inner = compilePredicate((predicate as { $not: PropertyPredicate }).$not, alias, params);
			return inner ? `NOT (${inner})` : "";
		}
		default:
			return compileLeaf(op, predicate, alias, params);
	}
}

function compileLeaf(
	op: string,
	predicate: PropertyPredicate,
	alias: string,
	params: SqlParam[],
): string {
	const body = (predicate as Record<string, unknown>)[op];
	if (!body || typeof body !== "object") return "";
	const fragments: string[] = [];
	for (const [path, value] of Object.entries(body)) {
		const expr = jsonExtractExpr(alias, path);
		const fragment = leafFragment(op, expr, value, params);
		if (fragment) fragments.push(fragment);
	}
	if (fragments.length === 0) return "";
	if (fragments.length === 1) return fragments[0] as string;
	return `(${fragments.join(" AND ")})`;
}

function leafFragment(op: string, expr: string, value: unknown, params: SqlParam[]): string {
	switch (op) {
		case "$eq":
			params.push(value as SqlParam);
			return `${expr} = ?`;
		case "$neq":
			params.push(value as SqlParam);
			return `${expr} != ?`;
		case "$gt":
			params.push(value as SqlParam);
			return `${expr} > ?`;
		case "$lt":
			params.push(value as SqlParam);
			return `${expr} < ?`;
		case "$gte":
			params.push(value as SqlParam);
			return `${expr} >= ?`;
		case "$lte":
			params.push(value as SqlParam);
			return `${expr} <= ?`;
		case "$contains":
			params.push(`%${String(value)}%`);
			return `${expr} LIKE ?`;
		case "$notContains":
			params.push(`%${String(value)}%`);
			return `${expr} NOT LIKE ?`;
		case "$like":
			params.push(String(value));
			return `${expr} LIKE ?`;
		case "$notLike":
			params.push(String(value));
			return `${expr} NOT LIKE ?`;
		case "$in": {
			const arr = (Array.isArray(value) ? value : []) as SqlParam[];
			if (arr.length === 0) return "0=1"; // empty IN matches nothing
			const placeholders = arr.map(() => "?").join(", ");
			params.push(...arr);
			return `${expr} IN (${placeholders})`;
		}
		case "$notIn": {
			const arr = (Array.isArray(value) ? value : []) as SqlParam[];
			if (arr.length === 0) return "1=1"; // empty NOT IN matches everything
			const placeholders = arr.map(() => "?").join(", ");
			params.push(...arr);
			return `${expr} NOT IN (${placeholders})`;
		}
		case "$exists":
			return `${expr} IS NOT NULL`;
		case "$empty":
			return `(${expr} IS NULL OR ${expr} = '' OR ${expr} = '[]')`;
		default:
			return "";
	}
}

function jsonExtractExpr(alias: string, path: PropertyPath): string {
	// Path syntax: dotted property path. We translate to SQLite JSON1's
	// `$.foo.bar` form. Identifiers with dots/brackets are not supported
	// in this iteration — the entities service can extend later.
	const sanitized = path
		.split(".")
		.map((segment) => {
			// Empty segments come from leading/trailing dots; skip them.
			if (segment.length === 0) return "";
			// Quote segments that look like array indices.
			if (/^\d+$/.test(segment)) return `[${segment}]`;
			// SECURITY: reject anything that could escape the surrounding
			// single-quoted JSON path literal (see PATH_SEGMENT_RE).
			if (!PATH_SEGMENT_RE.test(segment)) {
				throw new PatternCompileException({ code: "invalid-property-path", path });
			}
			return `.${segment}`;
		})
		.join("");
	return `json_extract(${alias}.properties, '$${sanitized}')`;
}

function firstKey(obj: object): string {
	for (const key in obj) return key;
	return "";
}
