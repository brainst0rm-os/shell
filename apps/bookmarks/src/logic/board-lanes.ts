/**
 * Board-lane building for the flexible "Group by" board (the generalized
 * replacement for the tags-only board). One pure function buckets a
 * bookmark list into ordered Kanban lanes along any `BookmarkGrouping`
 * axis. The renderer just paints lanes — every ordering / bucketing
 * decision lives here, tested without a DOM.
 *
 * The Tags axis preserves the EXACT prior behaviour (persisted lane
 * order, Untagged lane pinned last) by delegating to `buildTagBoardLanes`.
 * The other axes are read-only boards (no lane drag, no card-drag-to-lane
 * — "move a card into a domain lane" is meaningless): the renderer keys
 * its DnD off the grouping being Tags.
 *
 * i18n stays out of this module: a lane heading on a non-Tags axis IS an
 * already-localized value (a domain, a site, an author) and is passed as
 * the literal `label`. Period / trailing-bucket headings (Today, Older,
 * "Unknown domain") are i18n keys, so the caller injects them via the
 * `labels` callbacks — the function never touches `t()`.
 */

import type { Bookmark } from "../types/bookmark";
import { BookmarkGrouping } from "../types/surface";
import { buildTagBoardLanes } from "./tag-utils";

/** One Kanban lane of the flexible board. `key` is the stable React /
 *  DnD identity (a tag string, a domain, a period token, or `null` for a
 *  trailing bucket); `label` is the already-localized heading to paint
 *  (a tag is surfaced via the renderer's own `#tag` / "Untagged" mapping,
 *  so a Tags lane carries `label: null` and the renderer derives it). */
export type BoardLane = {
	key: string | null;
	label: string | null;
	bookmarks: readonly Bookmark[];
};

/** The four chronological buckets the SavedDate axis sections into, most
 *  recent first. The wire token doubles as the lane `key`. */
export enum SavedPeriod {
	Today = "today",
	Week = "week",
	Month = "month",
	Older = "older",
}

/** Period order, most recent first — the lane order for the SavedDate axis. */
const SAVED_PERIOD_ORDER: readonly SavedPeriod[] = Object.freeze([
	SavedPeriod.Today,
	SavedPeriod.Week,
	SavedPeriod.Month,
	SavedPeriod.Older,
]);

/** Localized-label callbacks the renderer injects so this module stays
 *  i18n-free. */
export type BoardLaneLabels = {
	/** Heading for a SavedDate period bucket. */
	savedPeriod(period: SavedPeriod): string;
	/** Trailing "Unknown domain" lane heading. */
	unknownDomain(): string;
	/** Trailing "Unknown site" lane heading. */
	unknownSite(): string;
	/** Trailing "Unknown author" lane heading. */
	unknownAuthor(): string;
};

export type BuildBoardLanesOptions = {
	/** Persisted manual lane order — consulted only for the Tags axis. */
	order?: readonly string[];
	/** Bare host of a bookmark URL, or null when unparseable. */
	host(url: string): string | null;
	/** Current epoch ms — the SavedDate axis buckets relative to this. */
	now: number;
	labels: BoardLaneLabels;
};

/** Bucket `savedAt` (epoch ms) into a coarse chronological period relative
 *  to `now`: today, the trailing 7 days, the trailing 30 days, or older. */
export function savedPeriodOf(savedAt: number, now: number): SavedPeriod {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const startOfToday = start.getTime();
	if (savedAt >= startOfToday) return SavedPeriod.Today;
	const day = 86_400_000;
	if (savedAt >= startOfToday - 6 * day) return SavedPeriod.Week;
	if (savedAt >= startOfToday - 29 * day) return SavedPeriod.Month;
	return SavedPeriod.Older;
}

type Bucket = { key: string; label: string; bookmarks: Bookmark[] };

/** Generic "bucket by a string key, order by count desc then key alpha,
 *  push empty-key matches into a trailing bucket" builder shared by the
 *  Domain / Site / Author axes. `keyOf` returns null for the empty case. */
function bucketByKey(
	bookmarks: readonly Bookmark[],
	keyOf: (b: Bookmark) => string | null,
	trailingLabel: string,
): BoardLane[] {
	const named = new Map<string, Bookmark[]>();
	const trailing: Bookmark[] = [];
	for (const bookmark of bookmarks) {
		const key = keyOf(bookmark);
		if (key === null) {
			trailing.push(bookmark);
			continue;
		}
		const list = named.get(key) ?? [];
		list.push(bookmark);
		named.set(key, list);
	}
	const buckets: Bucket[] = [...named.entries()].map(([key, list]) => ({
		key,
		label: key,
		bookmarks: list,
	}));
	buckets.sort((a, b) => {
		if (b.bookmarks.length !== a.bookmarks.length) return b.bookmarks.length - a.bookmarks.length;
		return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	});
	const lanes: BoardLane[] = buckets.map((bucket) => ({
		key: bucket.key,
		label: bucket.label,
		bookmarks: bucket.bookmarks,
	}));
	if (trailing.length > 0) lanes.push({ key: null, label: trailingLabel, bookmarks: trailing });
	return lanes;
}

/** Build ordered board lanes for `grouping`. Tags delegates to the
 *  prior tag-board logic (so lane order / Untagged-last is unchanged);
 *  the other axes bucket along their value. */
export function buildBoardLanes(
	bookmarks: readonly Bookmark[],
	grouping: BookmarkGrouping,
	opts: BuildBoardLanesOptions,
): BoardLane[] {
	switch (grouping) {
		case BookmarkGrouping.Tags:
			return buildTagBoardLanes(bookmarks, opts.order ?? []).map((lane) => ({
				key: lane.tag,
				label: null,
				bookmarks: lane.bookmarks,
			}));
		case BookmarkGrouping.Domain:
			return bucketByKey(bookmarks, (b) => opts.host(b.url), opts.labels.unknownDomain());
		case BookmarkGrouping.Site:
			return bucketByKey(
				bookmarks,
				(b) => {
					const site = b.siteName?.trim();
					if (site) return site;
					return opts.host(b.url);
				},
				opts.labels.unknownSite(),
			);
		case BookmarkGrouping.Author:
			return bucketByKey(
				bookmarks,
				(b) => {
					const author = b.author?.trim();
					return author ? author : null;
				},
				opts.labels.unknownAuthor(),
			);
		case BookmarkGrouping.SavedDate: {
			const buckets = new Map<SavedPeriod, Bookmark[]>();
			for (const bookmark of bookmarks) {
				const period = savedPeriodOf(bookmark.savedAt, opts.now);
				const list = buckets.get(period) ?? [];
				list.push(bookmark);
				buckets.set(period, list);
			}
			const lanes: BoardLane[] = [];
			for (const period of SAVED_PERIOD_ORDER) {
				const list = buckets.get(period);
				if (!list || list.length === 0) continue;
				list.sort((a, b) => b.savedAt - a.savedAt);
				lanes.push({ key: period, label: opts.labels.savedPeriod(period), bookmarks: list });
			}
			return lanes;
		}
	}
}
