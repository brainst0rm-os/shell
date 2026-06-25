/**
 * Pure compose logic — turn the add-bookmark form's raw fields into a
 * persisted `Bookmark`, or a typed rejection. DOM-free so the URL
 * normalize / dedupe / tag-normalize policy is unit-tested without a
 * popover. The renderer (`ui/compose-bookmark.ts`) is a thin shell over
 * this; the `intent.compose` entrypoint will reuse it verbatim.
 *
 * Reuses the existing keystones: `normalizeUrl` (the same canonical
 * form the codec + 9.18.6 scrape hash for dedup) and `normalizeTagList`
 * (the on-disk tag form).
 */

import type { Bookmark } from "../types/bookmark";
import { normalizeTagList } from "./tag-utils";
import { domainFromUrl, normalizeUrl } from "./url-parse";

export enum ComposeError {
	InvalidUrl = "invalid-url",
	Duplicate = "duplicate",
}

export type ComposeInput = {
	url: string;
	title?: string;
	description?: string;
	/** Raw tags string (comma / whitespace separated) or pre-split list. */
	tags?: string | readonly string[];
};

export type ComposeResult = { ok: true; bookmark: Bookmark } | { ok: false; error: ComposeError };

function splitTags(tags: string | readonly string[] | undefined): string[] {
	if (tags === undefined) return [];
	if (Array.isArray(tags)) return [...tags];
	return String(tags).split(/[,\n]/);
}

/** Build a new `Bookmark` from form input. Rejects a non-http(s) URL
 *  and a URL whose normalized form already exists in `existing`
 *  (same dedupe key the codec uses). `idFactory` / `now` are injected
 *  so the result is deterministic under test. */
export function composeBookmark(
	input: ComposeInput,
	existing: readonly Bookmark[],
	deps: { idFactory: () => string; now: () => number },
): ComposeResult {
	const url = normalizeUrl(input.url);
	if (url === null) return { ok: false, error: ComposeError.InvalidUrl };
	if (existing.some((b) => b.url === url)) {
		return { ok: false, error: ComposeError.Duplicate };
	}

	const ts = deps.now();
	const title = (input.title ?? "").trim() || (domainFromUrl(url) ?? url);

	const bookmark: Bookmark = {
		id: deps.idFactory(),
		url,
		title,
		icon: null,
		faviconUrl: null,
		coverImageUrl: null,
		tags: normalizeTagList(splitTags(input.tags)),
		savedAt: ts,
		readAt: null,
		archivedAt: null,
		colorHint: null,
		createdAt: ts,
		updatedAt: ts,
	};
	const description = (input.description ?? "").trim();
	if (description !== "") bookmark.description = description;
	return { ok: true, bookmark };
}

/** Re-normalize an edited tag string against a bookmark, returning the
 *  patched bookmark (or the same reference when nothing changed). */
export function applyTagEdit(bookmark: Bookmark, rawTags: string, now: () => number): Bookmark {
	const next = normalizeTagList(splitTags(rawTags));
	const same = next.length === bookmark.tags.length && next.every((t, i) => t === bookmark.tags[i]);
	if (same) return bookmark;
	return { ...bookmark, tags: next, updatedAt: now() };
}
