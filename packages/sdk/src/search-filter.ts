/**
 * `orderByHitRank` — project a list of an app's own entities down to the
 * ones the global search index matched, in the index's rank order.
 *
 * Every first-party app that grows an inline search bar (Tasks, Notes,
 * later Database / Calendar) does the same thing: it already holds its
 * entities in memory, calls `services.search.query`, and now wants to
 * show *its* objects filtered + ordered by relevance — not the raw
 * `SearchHit` rows (which carry only id/type/snippet, not the app's rich
 * domain shape). That projection is identical across apps; it lives here
 * so the rank semantics (and the dedupe/ordering edge cases) are written
 * and tested once.
 *
 * The indexer already returns hits best-first (bm25 asc, freshest tie-
 * break — see `search-indexer.ts`), so "rank order" is simply hit array
 * order; this function does not re-sort.
 */

/** Minimal shape this needs from a `SearchHit` — kept structural so the
 *  SDK doesn't force a `sdk-types` import on pure-logic callers/tests. */
export type RankableHit = {
	entityId: string;
};

/**
 * Returns the subset of `items` whose id appears in `hits`, ordered by
 * `hits` (best match first), each item at most once.
 *
 *   - An item whose id isn't in `hits` is dropped.
 *   - A hit whose id matches no item is skipped (the index can hold ids
 *     this app's in-memory list doesn't currently have — a sibling app's
 *     entity, or one deleted since the last load).
 *   - Duplicate hit ids collapse to the first occurrence (preserves the
 *     best rank for that id).
 *   - Duplicate item ids: the first item with that id wins.
 */
export function orderByHitRank<T>(
	items: readonly T[],
	hits: readonly RankableHit[],
	idOf: (item: T) => string,
): T[] {
	const byId = new Map<string, T>();
	for (const item of items) {
		const id = idOf(item);
		if (!byId.has(id)) byId.set(id, item);
	}
	const out: T[] = [];
	const seen = new Set<string>();
	for (const hit of hits) {
		const id = hit.entityId;
		if (seen.has(id)) continue;
		const item = byId.get(id);
		if (item === undefined) continue;
		seen.add(id);
		out.push(item);
	}
	return out;
}
