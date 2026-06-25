/**
 * `note-entities-codec.ts` — the pure, dependency-free contract for
 * projecting one stored Notes-app note into a shared-object-space
 * `Note/v1` entity row plus its derived mention / link edges.
 *
 * This is the 9.3.5.N-notes keystone, frozen before the (hard) Notes
 * migration the way 9.3.5.1 froze the Collection contract before its
 * migration rungs: both the *current* kv aggregator (`aggregateNotes`)
 * and the *future* entities-service-backed Notes repo derive the exact
 * same row + edge shape from a note, so Graph/Database keep painting
 * note-to-note edges identically once Notes moves off `kv.json`.
 *
 * Pure: no IO, no app deps. The `body` mention/link walk is delegated
 * to the existing `extract-note-references` protocol walker (the
 * persisted MentionNode `type` + `brainstorm://entity/` URI are
 * on-disk protocol — see that file's header).
 */

import {
	NoteReferenceKind,
	coerceNoteReferences,
	extractNoteReferences,
} from "./extract-note-references";
import type { VaultEntity, VaultLink } from "./vault-entities-service";

/** Canonical Notes identifiers — the single source of truth. Re-exported
 *  by `vault-entities-service` so existing import sites are unchanged. */
export const NOTES_APP_ID = "io.brainstorm.notes";
export const NOTE_TYPE = "io.brainstorm.notes/Note/v1";
export const NOTE_KEY_PREFIX = "note:";
export const NOTE_MENTION_LINK_TYPE = "io.brainstorm.notes/mention" as const;
export const NOTE_REFERENCE_LINK_TYPE = "io.brainstorm.notes/link" as const;

/** The loose persisted note shape (a parsed `kv.json` value). Every
 *  field is validated/defaulted here so callers never hand-roll it. */
export type StoredNoteLike = {
	id?: unknown;
	title?: unknown;
	icon?: unknown;
	body?: unknown;
	createdAt?: unknown;
	updatedAt?: unknown;
	/** Optional `Note/about` cross-link target — set by the seeder on
	 *  notes that mirror another entity (iteration-notes, doc-notes,
	 *  the hub note) so the graph paints a `Note/about` edge back to
	 *  the source. User-authored notes leave this unset. */
	aboutEntityId?: unknown;
	/** Pre-extracted body cross-references (`@`-mentions, transclusions,
	 *  embeds, inline links), persisted by the Notes autosave from the
	 *  live `SerializedEditorState`. The denormalised `body` field is a
	 *  plain-text snippet — it has NO rich nodes to walk — so without this
	 *  the graph never sees note→note edges (F-067). When present it is the
	 *  authoritative ref source; absent (legacy rows, or a rich-JSON `body`)
	 *  the codec falls back to walking `body`. */
	bodyRefs?: unknown;
};

export type NoteProjection = {
	entity: VaultEntity;
	links: VaultLink[];
};

/** Stable, deterministic link id — identical to the id `aggregateNotes`
 *  emitted inline before this codec existed, so the post-9.3.5.2
 *  shared-vs-kv dedupe (id collision → shared wins) keeps holding. */
export function noteLinkId(noteId: string, kind: NoteReferenceKind, destId: string): string {
	return `lnk_${noteId}_${kind}_${destId}`;
}

/** Project one stored note into its shared-space entity row + derived
 *  edges. `fallbackId` is used only when the note blob has no `id`
 *  (legacy rows keyed solely by `note:<id>`); `now` defaults the
 *  timestamps deterministically for callers that want it injectable. */
export function noteToProjection(
	note: StoredNoteLike,
	fallbackId: string,
	now: number = Date.now(),
): NoteProjection {
	const id = typeof note.id === "string" && note.id.length > 0 ? note.id : fallbackId;
	const title = typeof note.title === "string" ? note.title : "";
	const createdAt = typeof note.createdAt === "number" ? note.createdAt : now;
	const updatedAt = typeof note.updatedAt === "number" ? note.updatedAt : createdAt;

	const entity: VaultEntity = {
		id,
		type: NOTE_TYPE,
		properties: {
			name: title,
			title,
			icon: note.icon ?? null,
			// Carry the note body through — without it every Note entity
			// surfaced to apps (Notes editor, Database, Quick Look) showed
			// only a title. Shape is passed through as-stored (rich-text
			// JSON or string); consumers already handle both.
			body: note.body ?? null,
			// SH-37: seeder-written cross-link to a source entity (the
			// iteration this note narrates, the doc it mirrors, …) so the
			// graph picks up the `Note/about` derived edge. Non-string /
			// missing → null and no edge.
			aboutEntityId:
				typeof note.aboutEntityId === "string" && note.aboutEntityId.length > 0
					? note.aboutEntityId
					: null,
		},
		createdAt,
		updatedAt,
		deletedAt: null,
		ownerAppId: NOTES_APP_ID,
	};

	const links: VaultLink[] = [];
	// Persisted body-refs win (the denormalised `body` snippet has no rich
	// nodes to walk); fall back to walking `body` for legacy / rich-JSON rows.
	const refs = coerceNoteReferences(note.bodyRefs) ?? extractNoteReferences(note.body);
	for (const ref of refs) {
		links.push({
			id: noteLinkId(id, ref.kind, ref.entityId),
			sourceEntityId: id,
			destEntityId: ref.entityId,
			linkType:
				ref.kind === NoteReferenceKind.Mention ? NOTE_MENTION_LINK_TYPE : NOTE_REFERENCE_LINK_TYPE,
			createdAt: updatedAt,
			deletedAt: null,
		});
	}

	return { entity, links };
}
