/**
 * Surfaces the Bookmarks app renders. Inbox / Read / Archive are
 * mutually exclusive (each bookmark belongs to exactly one); Tags is a
 * cross-cutting view that re-buckets bookmarks regardless of which of
 * the three mutually-exclusive surfaces they live in.
 *
 * Resolves the surface enumeration call-out in Stage 9.18 / the
 * first-party apps roadmap memory.
 */

export enum BookmarkSurface {
	/** Active + unread bookmarks (`readAt === null && archivedAt === null`). */
	Inbox = "inbox",
	/** Active + read bookmarks (`readAt !== null && archivedAt === null`). */
	Read = "read",
	/** Archived (`archivedAt !== null`). */
	Archive = "archive",
	/** Cross-cutting board view grouped by `Bookmark.tags`. */
	Tags = "tags",
}

/** All four surfaces in display order — frozen, safe to iterate. */
export const BOOKMARK_SURFACES: readonly BookmarkSurface[] = Object.freeze([
	BookmarkSurface.Inbox,
	BookmarkSurface.Read,
	BookmarkSurface.Archive,
	BookmarkSurface.Tags,
]);

/** How the Tags board buckets bookmarks into lanes. Tags is the default
 *  (the original behaviour); the rest re-section the SAME bookmark set
 *  along a different axis — by host (Domain), source site name (Site),
 *  when it was saved (SavedDate), or article author (Author). The header
 *  exposes this as a "Group by ▾" picker, not a hardcoded mode — every
 *  axis is a one-click choice. Mirrors Tasks' `UpcomingGrouping`.
 *
 *  Only the Tags axis supports lane drag-reorder + card-drag-to-lane (a
 *  drop mutates the card's tags); the other axes are read-only boards —
 *  "move a card into a domain lane" is meaningless. */
export enum BookmarkGrouping {
	Tags = "tags",
	Domain = "domain",
	Site = "site",
	SavedDate = "saved-date",
	Author = "author",
}

/** All grouping axes in the order the "Group by" picker lists them —
 *  frozen, safe to iterate. */
export const BOOKMARK_GROUPINGS: readonly BookmarkGrouping[] = Object.freeze([
	BookmarkGrouping.Tags,
	BookmarkGrouping.Domain,
	BookmarkGrouping.Site,
	BookmarkGrouping.SavedDate,
	BookmarkGrouping.Author,
]);
