/**
 * Resolve-or-create a `Bookmark/v1` entity for a pasted URL, then hand back
 * the id + the block id that renders it inline (9.18.2b).
 *
 * Reuse decisions:
 *   - The entity is created through the SAME shared entities service Notes
 *     uses for every other cross-app write (`services.entities.create`),
 *     against the SAME `brainstorm/Bookmark/v1` type the Bookmarks app owns —
 *     so the row shows up in Bookmarks / Database / Graph unchanged.
 *   - "Resolve" first: a `query({type})` scan dedupes on the normalized URL so
 *     pasting the same link twice references the existing bookmark rather than
 *     forking a second row (matching the Bookmarks-app compose dedupe key).
 *   - The block id comes from `services.blocks.forType(BOOKMARK_ENTITY_TYPE)`
 *     — the registry resolves it to `io.brainstorm.bookmarks/bookmark` — and
 *     the embed itself is inserted via the existing `applyEmbedInsertion`
 *     `BlockEmbedNode` path (the same node every live embed uses). No new
 *     embed mechanism.
 */

import type { LexicalEditor, NodeKey } from "lexical";
import { BOOKMARK_ENTITY_TYPE, bookmarkEntityProperties, hostLabel } from "./bookmark-suggest";
import { applyEmbedInsertion } from "./embed-insert";

/** The slice of the shared entities service this helper touches. */
export type BookmarkEntities = {
	query(q: { type?: string | string[] }): Promise<
		readonly { id: string; properties: Record<string, unknown> }[]
	>;
	create(type: string, properties: Record<string, unknown>, id?: string): Promise<{ id: string }>;
};

/** The block-registry slice — `forType` resolves the live block id for an
 *  entity type, or `null` when no app provides one. */
export type BookmarkBlocks = {
	forType(type: string): Promise<string | null>;
};

export type ResolvedBookmark = {
	entityId: string;
	/** The bookmark's display title (host fallback) for the embed label. */
	label: string;
	/** `true` when a new row was minted, `false` when an existing one matched.
	 *  Surfaced so the caller's tests / telemetry can assert the dedupe path. */
	created: boolean;
};

/** Find an existing `Bookmark/v1` whose URL matches `url`, else create one.
 *  Failures (no service, IPC error) surface as a thrown rejection — the
 *  caller decides whether to fall back to a plain link. */
export async function resolveOrCreateBookmark(
	entities: BookmarkEntities,
	url: string,
	now: () => number,
): Promise<ResolvedBookmark> {
	const existing = await entities.query({ type: BOOKMARK_ENTITY_TYPE });
	const match = existing.find((row) => row.properties.url === url);
	if (match) {
		const title = typeof match.properties.title === "string" ? match.properties.title : "";
		return { entityId: match.id, label: title.trim() || hostLabel(url), created: false };
	}
	const props = bookmarkEntityProperties(url, now());
	const row = await entities.create(BOOKMARK_ENTITY_TYPE, props);
	const title = typeof props.title === "string" ? props.title : "";
	return { entityId: row.id, label: title.trim() || hostLabel(url), created: true };
}

/** Insert the embedded bookmark block referencing `bookmark.entityId` in
 *  place of `paragraphKey`, resolving the block id from the registry. Routes
 *  through `applyEmbedInsertion` (the shared `BlockEmbedNode` path) so a
 *  missing block id falls back to the generic shell card, same as every other
 *  embed. */
export async function insertBookmarkEmbed(
	editor: LexicalEditor,
	blocks: BookmarkBlocks | undefined,
	paragraphKey: NodeKey | null,
	bookmark: ResolvedBookmark,
): Promise<void> {
	let blockId: string | null = null;
	if (blocks) {
		try {
			blockId = await blocks.forType(BOOKMARK_ENTITY_TYPE);
		} catch {
			blockId = null;
		}
	}
	applyEmbedInsertion(editor, paragraphKey, {
		entityId: bookmark.entityId,
		entityType: BOOKMARK_ENTITY_TYPE,
		label: bookmark.label,
		...(blockId ? { blockId } : {}),
	});
}
