/**
 * Duplicate detection + merge (9.18.11). `composeBookmark` rejects a
 * same-URL add at compose time, but two devices can each save the same link
 * before they sync — the blind relay then lands two `Bookmark/v1` rows sharing
 * one normalized URL. This pure keystone finds those collisions and folds a
 * group into a single bookmark, keeping the richest of each field so no user
 * signal (tags, read state, the freshest capture, hand notes) is lost.
 *
 * DOM/storage-free: the app's merge action persists the result; this module
 * just decides the shape.
 */

import type { Bookmark } from "../types/bookmark";
import { normalizeTagList } from "./tag-utils";
import { domainFromUrl } from "./url-parse";

export type DuplicateGroup = {
	/** The shared normalized URL. */
	url: string;
	/** The colliding bookmarks, oldest first — `bookmarks[0]` is the merge
	 *  primary (its id + createdAt survive). Always ≥2. */
	bookmarks: readonly Bookmark[];
};

export type MergeResult = {
	/** The single merged bookmark (carries the primary's id). */
	merged: Bookmark;
	/** Ids of the absorbed duplicates to delete. */
	removedIds: readonly string[];
};

function byOldest(a: Bookmark, b: Bookmark): number {
	return (
		a.savedAt - b.savedAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
}

/**
 * Group bookmarks by their (already-normalized) URL and return only the groups
 * with a real collision (≥2 members). Each group's `bookmarks` is sorted oldest
 * first. Groups themselves are ordered by their primary's age (oldest first) so
 * the result is deterministic.
 */
export function findDuplicateGroups(bookmarks: readonly Bookmark[]): DuplicateGroup[] {
	const byUrl = new Map<string, Bookmark[]>();
	for (const b of bookmarks) {
		const list = byUrl.get(b.url);
		if (list) list.push(b);
		else byUrl.set(b.url, [b]);
	}
	const groups: DuplicateGroup[] = [];
	for (const [url, list] of byUrl) {
		if (list.length < 2) continue;
		groups.push({ url, bookmarks: [...list].sort(byOldest) });
	}
	groups.sort((a, b) => byOldest(a.bookmarks[0] as Bookmark, b.bookmarks[0] as Bookmark));
	return groups;
}

/** Whether a title is auto-derived (blank or just the domain/URL) rather than a
 *  meaningful one worth preserving over another copy's. */
function isAutoTitle(b: Bookmark): boolean {
	const t = b.title.trim();
	return t === "" || t === (domainFromUrl(b.url) ?? b.url);
}

function firstDefined<T>(
	group: readonly Bookmark[],
	pick: (b: Bookmark) => T | null | undefined,
): T | null {
	for (const b of group) {
		const v = pick(b);
		if (v !== null && v !== undefined) return v;
	}
	return null;
}

/**
 * Merge a duplicate group into one bookmark. Field policy:
 *  - **id / createdAt / savedAt** — the oldest copy (the primary) wins.
 *  - **title** — the first meaningful (non-auto) title, else the primary's.
 *  - **description** — the longest non-empty.
 *  - **tags** — the normalized union (primary order first).
 *  - **readAt** — earliest read across the group (read state is sticky).
 *  - **archivedAt** — archived only if *every* copy was archived (the earliest
 *    stamp); if any copy is still active the merge stays visible.
 *  - **content** — the freshest capture (max `contentFetchedAt`) with its
 *    provenance, so the newest extraction wins.
 *  - **notes** — distinct non-empty notes joined, primary first.
 *  - **icon / cover / favicon / siteName / mediaType / colorHint** — the
 *    primary's value, else the first copy that has one.
 *  - **updatedAt** — `now` (the merge is an edit).
 */
export function mergeBookmarks(group: DuplicateGroup, now: number): MergeResult {
	const list = group.bookmarks;
	const primary = list[0] as Bookmark;

	const titleSrc = list.find((b) => !isAutoTitle(b)) ?? primary;
	const description =
		list
			.map((b) => (b.description ?? "").trim())
			.filter((d) => d !== "")
			.sort((a, b) => b.length - a.length)[0] ?? "";

	const tags = normalizeTagList(list.flatMap((b) => [...b.tags]));

	const reads = list.map((b) => b.readAt).filter((v): v is number => v !== null);
	const readAt = reads.length > 0 ? Math.min(...reads) : null;

	const allArchived = list.every((b) => b.archivedAt !== null);
	const archivedAt = allArchived ? Math.min(...list.map((b) => b.archivedAt as number)) : null;

	// Freshest capture wins. Only copies that actually captured something compete.
	const captured = list
		.filter((b) => b.contentFetchedAt !== undefined)
		.sort((a, b) => (b.contentFetchedAt as number) - (a.contentFetchedAt as number))[0];

	const notes = Array.from(
		new Set(list.map((b) => (b.notes ?? "").trim()).filter((n) => n !== "")),
	).join("\n\n");

	const merged: Bookmark = {
		id: primary.id,
		url: primary.url,
		title: titleSrc.title,
		icon: firstDefined(list, (b) => b.icon),
		faviconUrl: firstDefined(list, (b) => b.faviconUrl),
		coverImageUrl: firstDefined(list, (b) => b.coverImageUrl),
		tags,
		savedAt: primary.savedAt,
		readAt,
		archivedAt,
		colorHint: firstDefined(list, (b) => b.colorHint),
		createdAt: primary.createdAt,
		updatedAt: now,
	};
	const cover = firstDefined(list, (b) => b.cover);
	if (cover) merged.cover = cover;
	if (description !== "") merged.description = description;
	const siteName = firstDefined(list, (b) => b.siteName);
	if (siteName) merged.siteName = siteName;
	const mediaType = firstDefined(list, (b) => b.mediaType);
	if (mediaType) merged.mediaType = mediaType;
	if (notes !== "") merged.notes = notes;
	if (captured?.contentBlocks) {
		merged.contentBlocks = captured.contentBlocks;
		if (captured.contentFetchedAt !== undefined) merged.contentFetchedAt = captured.contentFetchedAt;
		if (captured.contentProvenance) merged.contentProvenance = captured.contentProvenance;
	}

	return { merged, removedIds: list.slice(1).map((b) => b.id) };
}
