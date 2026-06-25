/**
 * Persistence codec for `Collection` (9.18.10). Collections live in the
 * Bookmarks kv silo under one key (`bookmark-collections`) as an array — the
 * interim store before the 9.3.5 entities remodel gives them their own type.
 * All shape validation lives here so a malformed / legacy / synced row drops
 * out rather than crashing the sidebar.
 */

import { type Collection, type CollectionFilter, CollectionKind } from "../logic/collections";
import { normalizeTagList } from "../logic/tag-utils";
import { BookmarkSurface } from "../types/surface";

export const COLLECTIONS_KEY = "bookmark-collections";

const SURFACES = new Set<string>(Object.values(BookmarkSurface));

function parseFilter(raw: unknown): CollectionFilter {
	if (!raw || typeof raw !== "object") return {};
	const r = raw as Record<string, unknown>;
	const filter: CollectionFilter = {};
	if (typeof r.surface === "string" && SURFACES.has(r.surface)) {
		filter.surface = r.surface as BookmarkSurface;
	}
	if (Array.isArray(r.tags)) {
		const tags = normalizeTagList(r.tags.filter((t): t is string => typeof t === "string"));
		if (tags.length > 0) filter.tags = tags;
	}
	if (typeof r.query === "string" && r.query.trim() !== "") filter.query = r.query;
	return filter;
}

export function parseCollection(raw: unknown): Collection | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || r.id === "") return null;
	if (typeof r.name !== "string" || r.name.trim() === "") return null;
	if (r.kind !== CollectionKind.Smart && r.kind !== CollectionKind.Manual) return null;
	if (typeof r.createdAt !== "number" || !Number.isFinite(r.createdAt)) return null;
	if (typeof r.updatedAt !== "number" || !Number.isFinite(r.updatedAt)) return null;

	const collection: Collection = {
		id: r.id,
		name: r.name,
		kind: r.kind,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
	if (r.kind === CollectionKind.Smart) {
		collection.filter = parseFilter(r.filter);
	} else {
		const ids = Array.isArray(r.memberIds)
			? (r.memberIds.filter((id): id is string => typeof id === "string" && id !== "") as string[])
			: [];
		collection.memberIds = ids;
	}
	return collection;
}

/** Parse the stored array, dropping any malformed entry. A non-array input
 *  (missing / legacy / corrupt) yields an empty list. */
export function parseCollections(raw: unknown): Collection[] {
	if (!Array.isArray(raw)) return [];
	const out: Collection[] = [];
	for (const entry of raw) {
		const parsed = parseCollection(entry);
		if (parsed) out.push(parsed);
	}
	return out;
}
