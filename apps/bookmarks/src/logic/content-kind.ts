/**
 * Content-kind classification (9.18.14). The metadata scrape stores a raw
 * OpenGraph `og:type` on `Bookmark.mediaType` (e.g. "article", "video.movie",
 * "music.song", "website"). That raw token is too granular + too jargon-y to
 * show a user, so this pure keystone folds it into a small `ContentKind`
 * enum and a stable message-key — surfaced as the friendly "Type" property
 * label and a card badge.
 *
 * DOM/i18n-free: the enum + the key MAP live here (unit-tested without a
 * renderer); the actual `t()` lookup happens at the call site.
 */

/** The user-facing content kinds a bookmark can be classified as. `Page` is the
 *  catch-all for an absent / unrecognised `og:type` (no badge is shown for it). */
export enum ContentKind {
	Article = "article",
	Video = "video",
	Audio = "audio",
	Image = "image",
	Book = "book",
	Profile = "profile",
	Product = "product",
	Website = "website",
	/** No `og:type`, or one we don't recognise — a generic page. */
	Page = "page",
}

/** OpenGraph `og:type` is dotted (`video.movie`, `music.song`); the kind is the
 *  segment before the first dot. This maps that root segment to a `ContentKind`. */
const ROOT_TO_KIND: Readonly<Record<string, ContentKind>> = {
	article: ContentKind.Article,
	blog: ContentKind.Article,
	video: ContentKind.Video,
	music: ContentKind.Audio,
	audio: ContentKind.Audio,
	image: ContentKind.Image,
	photo: ContentKind.Image,
	book: ContentKind.Book,
	books: ContentKind.Book,
	profile: ContentKind.Profile,
	product: ContentKind.Product,
	website: ContentKind.Website,
};

/**
 * Fold a raw `og:type` into a `ContentKind`. Tolerates casing, surrounding
 * whitespace, and the dotted Open Graph sub-types; an empty / unknown value
 * falls back to `ContentKind.Page`.
 */
export function classifyMediaType(raw: string | undefined | null): ContentKind {
	if (typeof raw !== "string") return ContentKind.Page;
	const root = raw.trim().toLowerCase().split(".")[0];
	if (!root) return ContentKind.Page;
	return ROOT_TO_KIND[root] ?? ContentKind.Page;
}

/** Stable i18n message keys (defined in `i18n/manifest.ts`) for each kind. The
 *  call site does the `t()` lookup so this module stays renderer-free. */
export const CONTENT_KIND_LABEL_KEY: Readonly<Record<ContentKind, string>> = {
	[ContentKind.Article]: "contentKind.article",
	[ContentKind.Video]: "contentKind.video",
	[ContentKind.Audio]: "contentKind.audio",
	[ContentKind.Image]: "contentKind.image",
	[ContentKind.Book]: "contentKind.book",
	[ContentKind.Profile]: "contentKind.profile",
	[ContentKind.Product]: "contentKind.product",
	[ContentKind.Website]: "contentKind.website",
	[ContentKind.Page]: "contentKind.page",
};

/** Whether the kind is distinctive enough to warrant a card badge. The generic
 *  `Page` / `Website` kinds are the unmarked default — badging them is noise. */
export function hasDistinctKind(kind: ContentKind): boolean {
	return kind !== ContentKind.Page && kind !== ContentKind.Website;
}
