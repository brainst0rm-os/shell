/**
 * Collections (9.18.10). Tags are a single flat dimension; collections add a
 * second, durable grouping — either a **smart collection** (a saved filter that
 * stays live as bookmarks change) or a **manual collection** (an explicit set
 * of member ids). This pure keystone owns the model + membership evaluation so
 * the same rules drive the sidebar list, the main pane, and (later) the
 * 9.3.5 entities-backed store without a rewrite.
 *
 * DOM/storage-free: persistence + rendering live in the app; this decides
 * membership.
 */

import type { Bookmark } from "../types/bookmark";
import { BookmarkSurface } from "../types/surface";
import { surfaceFor } from "./surface-for";

export enum CollectionKind {
	/** A saved filter — membership is re-evaluated live as bookmarks change. */
	Smart = "smart",
	/** An explicit, hand-curated set of bookmark ids. */
	Manual = "manual",
}

/** A smart collection's saved filter. Every present clause is ANDed; an absent
 *  clause is unconstrained. `tags` requires ALL listed tags (intersection). */
export type CollectionFilter = {
	/** Restrict to one lifecycle surface (inbox/read/archive). Absent = any. */
	surface?: BookmarkSurface;
	/** Require every one of these (already-normalized) tags. */
	tags?: readonly string[];
	/** Case-insensitive substring over title + URL + description. */
	query?: string;
};

export type Collection = {
	id: string;
	name: string;
	kind: CollectionKind;
	/** Smart only — the saved filter. */
	filter?: CollectionFilter;
	/** Manual only — explicit member ids. */
	memberIds?: readonly string[];
	createdAt: number;
	updatedAt: number;
};

/** Whether a bookmark satisfies a smart-collection filter. An empty filter
 *  matches everything. */
export function matchesFilter(bookmark: Bookmark, filter: CollectionFilter): boolean {
	if (filter.surface !== undefined && surfaceFor(bookmark) !== filter.surface) return false;
	if (filter.tags && filter.tags.length > 0) {
		const owned = new Set(bookmark.tags);
		if (!filter.tags.every((tag) => owned.has(tag))) return false;
	}
	const query = filter.query?.trim().toLowerCase();
	if (query) {
		const hay = `${bookmark.title} ${bookmark.url} ${bookmark.description ?? ""}`.toLowerCase();
		if (!hay.includes(query)) return false;
	}
	return true;
}

/** The bookmarks that belong to a collection. Smart → live filter; Manual →
 *  the explicit ids, preserving the input order (not the id-list order) so the
 *  main pane keeps its sort. */
export function collectionMembers(
	collection: Collection,
	bookmarks: readonly Bookmark[],
): Bookmark[] {
	if (collection.kind === CollectionKind.Smart) {
		const filter = collection.filter ?? {};
		return bookmarks.filter((b) => matchesFilter(b, filter));
	}
	const ids = new Set(collection.memberIds ?? []);
	return bookmarks.filter((b) => ids.has(b.id));
}

/** Live member count — what the sidebar badge shows. */
export function collectionCount(collection: Collection, bookmarks: readonly Bookmark[]): number {
	return collectionMembers(collection, bookmarks).length;
}

/** Build a smart collection from the currently-active surface + tag selection
 *  ("Save current view"). A `Tags`-overview selection (no specific tag) carries
 *  no surface constraint; a specific surface/tag is captured as the filter. */
export function smartCollectionFromView(
	name: string,
	surface: BookmarkSurface,
	tag: string | null,
	deps: { idFactory: () => string; now: () => number },
): Collection {
	const filter: CollectionFilter = {};
	// The Tags surface is a cross-cutting board, not a lifecycle constraint — only
	// inbox/read/archive translate to a surface filter.
	if (surface !== BookmarkSurface.Tags) filter.surface = surface;
	if (tag) filter.tags = [tag];
	const ts = deps.now();
	return {
		id: deps.idFactory(),
		name: name.trim() || defaultCollectionName(surface, tag),
		kind: CollectionKind.Smart,
		filter,
		createdAt: ts,
		updatedAt: ts,
	};
}

/** A fallback name when the user saved a view without typing one. */
export function defaultCollectionName(surface: BookmarkSurface, tag: string | null): string {
	if (tag) return `#${tag}`;
	return surface;
}
