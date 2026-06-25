/**
 * entities.db v6 transform — canonicalize legacy select values.
 *
 * Select/status property VALUES are stored as the dictionary option id. A
 * system option's id is now its semantic key (`done`), but the dev seed once
 * built option ids as `di-{dictId}-{label}` (e.g. `di-dict-task-status-done`).
 * Any entity that had a seeded-vocabulary select edited through the property
 * cell back then holds that legacy id, which no longer matches the dictionary
 * (whose item id is now the bare key) — so its filter / colour silently miss.
 *
 * This rewrites those legacy ids back to the bare key. It is intentionally
 * narrow: only the two known seeded dictionaries (`dict-task-status`,
 * `dict-task-priority`) ever produced this `di-…` shape, and a user-created
 * option's opaque id (`di_<ts>_<rand>`) never matches this prefix, so it is
 * left untouched. Pure + exhaustive over scalar and multi-value cells.
 */

const LEGACY_PREFIX = /^di-(?:dict-task-status|dict-task-priority)-(.+)$/;

/** Map one stored cell value through the legacy→key rewrite. A scalar string
 *  is rewritten if it matches; an array maps each element; anything else
 *  passes through unchanged. */
function rewriteValue(value: unknown): unknown {
	if (typeof value === "string") {
		const m = LEGACY_PREFIX.exec(value);
		return m ? m[1] : value;
	}
	if (Array.isArray(value)) {
		let touched = false;
		const next = value.map((el) => {
			if (typeof el !== "string") return el;
			const m = LEGACY_PREFIX.exec(el);
			if (!m) return el;
			touched = true;
			return m[1];
		});
		return touched ? next : value;
	}
	return value;
}

/** Rewrite legacy `di-dict-task-*` select values in an entity's properties to
 *  the bare key. Returns the same reference when nothing changed so callers
 *  can skip the write. */
export function migrateLegacySelectValues(properties: Record<string, unknown>): {
	changed: boolean;
	properties: Record<string, unknown>;
} {
	let changed = false;
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(properties)) {
		const rewritten = rewriteValue(value);
		if (rewritten !== value) changed = true;
		next[key] = rewritten;
	}
	return changed ? { changed, properties: next } : { changed: false, properties };
}
