/**
 * Canonical entity Y.Doc layout — `brainstorm/EntityDoc/v1`.
 *
 * Per docs/editing/06-collaboration-yjs.md §Granularity, the unit of CRDT
 * state is **the entity**: each entity is backed by exactly one Y.Doc, and
 * that doc — not the SQLite row — is the source of truth. `entities.db` is
 * a *derived projection* rebuilt from the doc on every update (local or
 * synced-in), so it can serve fast list/property/search reads without
 * cracking open every Y.Doc.
 *
 * A canonical entity Y.Doc has these well-known roots:
 *  - `"root"` (`Y.XmlText`) — the universal rich-text body. Pinned by
 *    [[UNIVERSAL_BODY_FRAGMENT_NAME]]; bound by `@lexical/yjs`.
 *  - `ENTITY_PROPS_MAP_NAME` (`Y.Map`) — the entity's property bag. Atomic
 *    fields are plain JSON values (atomic-replace merge per doc 06);
 *    character-merged fields (title, code) become `Y.Text` later.
 *  - `ENTITY_LINKS_ARRAY_NAME` (`Y.Array`) — the entity's outgoing links.
 *  - `"brainstorm.meta"` (`Y.Map`) — shell-owned metadata (member wraps,
 *    Stage 10.3a). Kept hard-coded in the ydoc worker so it stays
 *    crypto-free of this module.
 *
 * These names are part of the on-disk protocol — changing one invalidates
 * every existing snapshot. Centralised here so the ydoc worker, the
 * entities service, the projection codec, and the apps all reach the same
 * roots through one import.
 */

export const ENTITY_PROPS_MAP_NAME = "brainstorm.props" as const;
export const ENTITY_LINKS_ARRAY_NAME = "brainstorm.links" as const;

export type EntityPropsMapName = typeof ENTITY_PROPS_MAP_NAME;
export type EntityLinksArrayName = typeof ENTITY_LINKS_ARRAY_NAME;

/** One outgoing link as stored in the entity doc's links array and
 *  projected into `entities.db`'s `links` table. `sourceEntityId` is the
 *  owning entity (implicit — it owns the doc), so it is not stored in the
 *  record. */
export type EntityDocLink = {
	id: string;
	destEntityId: string;
	linkType: string;
	createdAt: number;
};
