/**
 * Pure tab-strip model + view-lifecycle reducer for `ListView/v1` (9.12.5).
 *
 * `List.views` is the canonical ordered id list — the order tabs render in
 * and the order the user drags them into. The in-app `state.views` array is
 * an unordered pool keyed by id; the strip is derived from it by honouring
 * `List.views`. These helpers own the *order* + *active-tab* + *delete
 * re-pointing* arithmetic that `list-crud.ts` (which mints/clones individual
 * views) deliberately leaves to the caller, so the chrome in `app.ts` never
 * hand-rolls a tab model.
 *
 * Every function is pure: it takes plain data and returns new data. Callers
 * replace `List.views` / `List.defaultViewId` / the active view id and
 * persist.
 */

import type { List } from "../types/list";
import type { ListView } from "../types/list-view";

/** One entry in the rendered tab strip — already ordered + active-flagged. */
export type ViewTab = {
	id: string;
	name: string;
	kind: ListView["kind"];
	icon: ListView["icon"];
	active: boolean;
};

/**
 * Order a List's views by its canonical `List.views` id order. Ids present in
 * the pool but missing from `order` are appended in pool order (a view minted
 * since the order array was last written must still show), and ids in `order`
 * that no longer resolve to a live view are dropped. The pool is filtered to
 * this list's views first, so passing the whole `state.views` is safe.
 */
export function orderViewsForStrip(
	pool: ReadonlyArray<ListView>,
	listId: string,
	order: ReadonlyArray<string>,
): ListView[] {
	const mine = pool.filter((v) => v.listId === listId);
	const byId = new Map(mine.map((v) => [v.id, v]));
	const seen = new Set<string>();
	const ordered: ListView[] = [];
	for (const id of order) {
		const view = byId.get(id);
		if (view && !seen.has(id)) {
			ordered.push(view);
			seen.add(id);
		}
	}
	for (const view of mine) {
		if (!seen.has(view.id)) ordered.push(view);
	}
	return ordered;
}

/** Build the active-flagged tab descriptors for a list's strip. */
export function buildViewTabs(
	pool: ReadonlyArray<ListView>,
	listId: string,
	order: ReadonlyArray<string>,
	activeViewId: string | null,
): ViewTab[] {
	return orderViewsForStrip(pool, listId, order).map((v) => ({
		id: v.id,
		name: v.name,
		kind: v.kind,
		icon: v.icon,
		active: v.id === activeViewId,
	}));
}

/**
 * Move `movingId` so it sits immediately before `beforeId` in `order`. A
 * `beforeId` of `null` drops the moved id at the end (drag past the last tab).
 * No-op (returns the same reference) when the move would change nothing, when
 * `movingId` is absent, or when `movingId === beforeId`.
 */
export function reorderViews(
	order: ReadonlyArray<string>,
	movingId: string,
	beforeId: string | null,
): string[] {
	if (movingId === beforeId) return order as string[];
	const from = order.indexOf(movingId);
	if (from === -1) return order as string[];
	const without = order.filter((id) => id !== movingId);
	if (beforeId === null) {
		const next = [...without, movingId];
		return sameOrder(order, next) ? (order as string[]) : next;
	}
	const target = without.indexOf(beforeId);
	if (target === -1) return order as string[];
	const next = [...without.slice(0, target), movingId, ...without.slice(target)];
	return sameOrder(order, next) ? (order as string[]) : next;
}

/**
 * Move `movingId` one slot toward `delta` (-1 = left, +1 = right) in `order`.
 * The keyboard twin of {@link reorderViews}: a focused tab steps left/right
 * with the arrow chords without the caller computing a `beforeId`. Clamps at
 * the ends (a left step on the first tab, a right step on the last tab) and at
 * an absent `movingId` — each returns the same reference so a no-op step never
 * triggers a re-render or a persist.
 */
export function moveViewByStep(
	order: ReadonlyArray<string>,
	movingId: string,
	delta: -1 | 1,
): string[] {
	const from = order.indexOf(movingId);
	if (from === -1) return order as string[];
	const to = from + delta;
	if (to < 0 || to >= order.length) return order as string[];
	const next = [...order];
	const [moved] = next.splice(from, 1);
	if (moved === undefined) return order as string[];
	next.splice(to, 0, moved);
	return next;
}

function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Pick the tab to fall to when `removedId` is closed, given the *pre-removal*
 * ordered strip and which view was active. Falls to the neighbour after the
 * removed tab, else the one before, else `null` (last tab closed). When the
 * removed tab wasn't the active one, the active view is preserved.
 */
export function nextActiveAfterRemoval(
	orderedIds: ReadonlyArray<string>,
	removedId: string,
	activeViewId: string | null,
): string | null {
	if (activeViewId !== removedId) {
		return activeViewId && orderedIds.includes(activeViewId) ? activeViewId : null;
	}
	const idx = orderedIds.indexOf(removedId);
	if (idx === -1) return null;
	for (let i = idx + 1; i < orderedIds.length; i += 1) {
		const id = orderedIds[i];
		if (id !== undefined) return id;
	}
	for (let i = idx - 1; i >= 0; i -= 1) {
		const id = orderedIds[i];
		if (id !== undefined) return id;
	}
	return null;
}

/** The result of removing a view: the rewritten list + the pruned pool +
 *  the id the strip should activate next. */
export type RemoveViewResult = {
	list: List;
	views: ListView[];
	nextActiveViewId: string | null;
};

/**
 * Remove a view from a List and resolve the fallout in one pass — prune the
 * pool, drop the id from `List.views`, re-point `List.defaultViewId` if it was
 * the removed view (to the new first remaining view), and compute the next
 * active tab. A List always keeps at least one view: removing the last view is
 * refused (returns the inputs unchanged with the active id intact).
 */
export function removeView(
	list: List,
	pool: ReadonlyArray<ListView>,
	removedId: string,
	activeViewId: string | null,
): RemoveViewResult {
	const orderedIds = orderViewsForStrip(pool, list.id, list.views).map((v) => v.id);
	if (orderedIds.length <= 1 || !orderedIds.includes(removedId)) {
		return { list, views: pool as ListView[], nextActiveViewId: activeViewId };
	}
	const nextActiveViewId = nextActiveAfterRemoval(orderedIds, removedId, activeViewId);
	const views = pool.filter((v) => v.id !== removedId);
	const remainingOrder = list.views.filter((id) => id !== removedId);
	const defaultViewId =
		list.defaultViewId === removedId ? (remainingOrder[0] ?? null) : list.defaultViewId;
	const nextList: List = {
		...list,
		views: remainingOrder,
		defaultViewId,
		updatedAt: Date.now(),
	};
	return { list: nextList, views, nextActiveViewId };
}

/** Append a freshly-minted view to a List's canonical order (after `createView`
 *  has produced the view). Idempotent if the id is already present. */
export function appendViewToList(list: List, viewId: string): List {
	if (list.views.includes(viewId)) return list;
	return { ...list, views: [...list.views, viewId], updatedAt: Date.now() };
}

/**
 * Splice a freshly-minted `viewId` into a List's canonical order immediately
 * after `afterId` (the view it was created next to — e.g. the source of a
 * Duplicate, or the active tab a "+" was clicked beside). A duplicated view
 * lands beside its source instead of at the far end of the strip.
 *
 * Falls back to an append when `afterId` is `null` or doesn't resolve to a
 * live entry in the order. Idempotent: an id already present returns the same
 * reference (it's already placed; no re-ordering).
 */
export function insertViewAfter(list: List, viewId: string, afterId: string | null): List {
	if (list.views.includes(viewId)) return list;
	const at = afterId === null ? -1 : list.views.indexOf(afterId);
	if (at === -1) return { ...list, views: [...list.views, viewId], updatedAt: Date.now() };
	const views = [...list.views.slice(0, at + 1), viewId, ...list.views.slice(at + 1)];
	return { ...list, views, updatedAt: Date.now() };
}
