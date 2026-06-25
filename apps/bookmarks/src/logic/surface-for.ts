/**
 * `surfaceFor(bookmark)` — pure routing helper that picks the
 * mutually-exclusive surface (Inbox / Read / Archive) a bookmark
 * belongs to. The Tags surface is cross-cutting — it includes every
 * bookmark regardless of which of the three primary surfaces routes it,
 * so it has no entry here.
 *
 * Long-term keystone: survives the Stage 9.3 entities-service swap
 * because the inputs (`readAt`, `archivedAt` nullable epoch fields)
 * are part of the Bookmark contract, not the storage substrate.
 */

import type { Bookmark } from "../types/bookmark";
import { BookmarkSurface } from "../types/surface";

export function surfaceFor(bookmark: Bookmark): BookmarkSurface {
	if (bookmark.archivedAt !== null) return BookmarkSurface.Archive;
	if (bookmark.readAt !== null) return BookmarkSurface.Read;
	return BookmarkSurface.Inbox;
}

/** Filter helper — given a `BookmarkSurface` selection, return the
 *  bookmarks that belong to it. `Tags` returns every bookmark
 *  (cross-cutting); the renderer's tag-board groups them via
 *  `groupByTag`. */
export function filterForSurface(
	bookmarks: readonly Bookmark[],
	surface: BookmarkSurface,
): readonly Bookmark[] {
	if (surface === BookmarkSurface.Tags) return bookmarks;
	return bookmarks.filter((b) => surfaceFor(b) === surface);
}
