/**
 * Tag helpers — the on-disk normalization the Bookmarks app applies on
 * every tag write, so the tag-board groupings match without further
 * collapsing in the renderer.
 *
 * Normalization rules: lowercase, trim outer whitespace, collapse
 * interior whitespace runs to a single hyphen, drop empty results.
 * The `read-later` tag (special semantic — see 9.18 plan) is just a
 * conventional tag, not a separate field.
 */

import type { Bookmark } from "../types/bookmark";

/** Normalize a single tag. Returns `null` for empty / whitespace-only
 *  input — caller filters out nulls before persisting. */
export function normalizeTag(input: string): string | null {
	const trimmed = input.trim().toLowerCase();
	if (trimmed === "") return null;
	const collapsed = trimmed.replace(/\s+/g, "-");
	return collapsed;
}

/** Normalize + dedup a list of tags. Preserves first-occurrence order so
 *  the user's hand-typed sequence ("work, urgent, work") sorts as the
 *  user typed it minus duplicates. */
export function normalizeTagList(tags: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const tag = normalizeTag(raw);
		if (tag === null) continue;
		if (seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

export type TagCount = {
	tag: string;
	count: number;
};

/** Build the (tag, count) histogram across a bookmark list. Sorted by
 *  count desc + then alphabetically for stable rendering. */
export function uniqueTags(bookmarks: readonly Bookmark[]): TagCount[] {
	const counts = new Map<string, number>();
	for (const bookmark of bookmarks) {
		for (const tag of bookmark.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	const result: TagCount[] = [...counts.entries()].map(([tag, count]) => ({ tag, count }));
	result.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
	});
	return result;
}

/** Bucket bookmarks by tag. A bookmark with N tags appears in N
 *  buckets. Untagged bookmarks land in the `null`-keyed bucket which
 *  the renderer surfaces as "Untagged". */
export function groupByTag(
	bookmarks: readonly Bookmark[],
): ReadonlyMap<string | null, readonly Bookmark[]> {
	const buckets = new Map<string | null, Bookmark[]>();
	for (const bookmark of bookmarks) {
		if (bookmark.tags.length === 0) {
			const untagged = buckets.get(null) ?? [];
			untagged.push(bookmark);
			buckets.set(null, untagged);
			continue;
		}
		for (const tag of bookmark.tags) {
			const list = buckets.get(tag) ?? [];
			list.push(bookmark);
			buckets.set(tag, list);
		}
	}
	return buckets;
}

/** One Kanban-style lane of the Database-style tag board (9.18.3).
 *  `tag: null` is the trailing "Untagged" lane. */
export type TagBoardLane = {
	tag: string | null;
	bookmarks: readonly Bookmark[];
};

/** Ordered lanes for the tag board: any tags in the user's persisted
 *  `order` come first (in that order), then the rest by `uniqueTags`
 *  order (count desc, then alpha), empties skipped, the Untagged lane
 *  always last (and only when non-empty). The whole ordering decision
 *  lives here — the renderer just paints lanes — so it's tested without
 *  a DOM (`renderTagsOverview` was the inline-logic 2nd call site this
 *  replaces; the future fancy board is the 3rd). */
export function buildTagBoardLanes(
	bookmarks: readonly Bookmark[],
	order: readonly string[] = [],
): TagBoardLane[] {
	const buckets = groupByTag(bookmarks);
	const lanes: TagBoardLane[] = [];
	const placed = new Set<string>();
	const push = (tag: string): void => {
		if (placed.has(tag)) return;
		const list = buckets.get(tag);
		if (list && list.length > 0) {
			lanes.push({ tag, bookmarks: list });
			placed.add(tag);
		}
	};
	for (const tag of order) push(tag);
	for (const { tag } of uniqueTags(bookmarks)) push(tag);
	const untagged = buckets.get(null);
	if (untagged && untagged.length > 0) lanes.push({ tag: null, bookmarks: untagged });
	return lanes;
}

/** Apply a Kanban card move (`Move (replace source tag)` semantic): the
 *  card leaves `fromTag`'s lane and joins `toTag`'s — the origin tag is
 *  removed and the destination tag added, every other tag preserved.
 *  Dropping onto the Untagged lane (`toTag === null`) just removes the
 *  origin tag. Returns the same array reference when nothing changes
 *  (drop onto the originating lane) so callers can no-op cheaply. */
export function retagForLaneMove(
	tags: readonly string[],
	fromTag: string | null,
	toTag: string | null,
): readonly string[] {
	if (fromTag === toTag) return tags;
	const next = tags.filter((tag) => tag !== fromTag);
	if (toTag !== null && !next.includes(toTag)) next.push(toTag);
	return normalizeTagList(next);
}

/** Reorder the lane sequence: move `dragTag` to sit immediately before
 *  `targetTag`. Operates over the currently-displayed string-tag order
 *  (the Untagged lane is pinned last and never passed here), so the
 *  result is a complete, stable order the caller persists. A `dragTag`
 *  not present is appended; a `targetTag` not present leaves `dragTag`
 *  at the end. */
export function reorderTags(
	order: readonly string[],
	dragTag: string,
	targetTag: string,
): string[] {
	if (dragTag === targetTag) return [...order];
	const next = order.filter((tag) => tag !== dragTag);
	const idx = next.indexOf(targetTag);
	if (idx < 0) {
		next.push(dragTag);
		return next;
	}
	next.splice(idx, 0, dragTag);
	return next;
}
