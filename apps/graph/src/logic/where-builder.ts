/**
 * 9.13.9 — the subject `where` predicate builder (in-app).
 *
 * `Subject.where` is a recursive `PropertyPredicate` tree; the runtime
 * compiler (entities service, Stage 9.3) and the *visual* builder (the
 * Database app's shared predicate component) own the full grammar. The
 * Graph app must not import cross-app, so this is a self-contained,
 * proportionate slice: the common case is a flat list of leaf comparisons
 * ANDed together (`status = done AND priority > 2`). This module is the
 * pure, tested bridge between that editable **row list** and the
 * `PropertyPredicate` shape `match-pattern.ts` already evaluates.
 *
 * Reuses the predicate *concepts* (`PropertyPredicate`, the `$op` leaves,
 * `$and`) — never another app's code.
 *
 * Round-trip contract: `rowsToPredicate(predicateToRows(p))` is
 * value-equivalent for any predicate this builder can author (a flat
 * `$and` of single-key leaves, or a lone leaf). A predicate too rich for
 * the flat editor (nested `$or`/`$not`, multi-key leaves) is reported as
 * non-editable so the UI can fall back to read-only instead of silently
 * corrupting it.
 */

import type { PropertyPredicate, ScalarValue } from "../types/predicate";

/** The leaf comparison operators the flat builder offers. A typed enum,
 *  not string literals at call sites (project convention). The string
 *  value *is* the wire `$op` key — the enum centralises it. */
export enum WhereOp {
	Eq = "$eq",
	Neq = "$neq",
	Contains = "$contains",
	NotContains = "$notContains",
	Gt = "$gt",
	Lt = "$lt",
	Gte = "$gte",
	Lte = "$lte",
	Like = "$like",
	NotLike = "$notLike",
	Exists = "$exists",
	Empty = "$empty",
}

export const WHERE_OPS: readonly WhereOp[] = Object.values(WhereOp);

/** Operators whose value is implicit (presence tests) — the UI hides the
 *  value field for these. */
export function isUnaryOp(op: WhereOp): boolean {
	return op === WhereOp.Exists || op === WhereOp.Empty;
}

/** One editable predicate row: a property path, an operator, and (unless
 *  the op is unary) a scalar value. */
export type WhereRow = {
	property: string;
	op: WhereOp;
	value: string;
};

export function emptyWhereRow(): WhereRow {
	return { property: "", op: WhereOp.Eq, value: "" };
}

function isWhereOp(key: string): key is WhereOp {
	return (WHERE_OPS as readonly string[]).includes(key);
}

/** Coerce the row's string value to the scalar the predicate carries. The
 *  evaluator compares numbers with `===`/`>`; a numeric-looking string
 *  becomes a number, `true`/`false` become booleans, everything else
 *  stays a string. Unary ops carry `true` (the `$exists`/`$empty` shape). */
function coerceValue(op: WhereOp, raw: string): ScalarValue | true {
	if (isUnaryOp(op)) return true;
	const trimmed = raw.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
	return raw;
}

function leafFor(row: WhereRow): PropertyPredicate {
	const value = coerceValue(row.op, row.value);
	return { [row.op]: { [row.property]: value } } as PropertyPredicate;
}

/** Build the `PropertyPredicate` for a row list. Empty / property-less
 *  rows are dropped (an in-progress row shouldn't filter the graph). No
 *  usable rows → `null` (no constraint). One → the bare leaf. Many → an
 *  `$and`. */
export function rowsToPredicate(rows: readonly WhereRow[]): PropertyPredicate | null {
	const usable = rows.filter((r) => r.property.trim() !== "");
	if (usable.length === 0) return null;
	const leaves = usable.map(leafFor);
	if (leaves.length === 1) return leaves[0] as PropertyPredicate;
	return { $and: leaves };
}

function firstKey(o: object): string {
	return Object.keys(o)[0] ?? "";
}

/** Decompose a leaf predicate into a single row, or `null` if it isn't a
 *  flat-editable single-key leaf. */
function leafToRow(leaf: PropertyPredicate): WhereRow | null {
	const op = firstKey(leaf);
	if (!isWhereOp(op)) return null;
	const body = (leaf as Record<string, unknown>)[op];
	if (!body || typeof body !== "object") return null;
	const keys = Object.keys(body as object);
	if (keys.length !== 1) return null; // multi-key leaf — not flat-editable
	const property = keys[0] as string;
	const rawValue = (body as Record<string, unknown>)[property];
	const value = isUnaryOp(op) ? "" : rawValue == null ? "" : String(rawValue);
	return { property, op, value };
}

export type DecomposeResult =
	| { editable: true; rows: WhereRow[] }
	| { editable: false; rows: WhereRow[] };

/** Decompose a `Subject.where` predicate into editable rows. `editable`
 *  is false when the predicate uses grammar the flat builder can't
 *  round-trip (`$or`, `$not`, nested `$and`, multi-key leaves) — the UI
 *  then shows the rows it *could* read but disables editing rather than
 *  dropping the richer structure on save. `null` → one empty starter row. */
export function predicateToRows(predicate: PropertyPredicate | null): DecomposeResult {
	if (predicate == null) return { editable: true, rows: [emptyWhereRow()] };
	const top = firstKey(predicate);

	if (top === "$and") {
		const children = (predicate as { $and: PropertyPredicate[] }).$and;
		const rows: WhereRow[] = [];
		let editable = true;
		for (const child of children) {
			const row = leafToRow(child);
			if (row) rows.push(row);
			else editable = false; // a non-leaf child (nested group) — read-only
		}
		if (rows.length === 0) return { editable: false, rows: [emptyWhereRow()] };
		return editable ? { editable: true, rows } : { editable: false, rows };
	}

	if (top === "$or" || top === "$not") {
		return { editable: false, rows: [emptyWhereRow()] };
	}

	const row = leafToRow(predicate);
	if (row) return { editable: true, rows: [row] };
	return { editable: false, rows: [emptyWhereRow()] };
}
