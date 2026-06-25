/**
 * `NotesRepository` — the storage contract `useNotes` is written against.
 * Implemented by `createEntitiesRepository` (the shared `entities.db`
 * store); the hook's call sites depend only on this type.
 *
 * Contract: `listAll` swallows a read failure → empty map (the user can
 * still create notes on a bad boot); `save` / `remove` *throw* so the hook
 * keeps its error-surfacing UX (create / delete set a banner; the debounced
 * autosave only logs).
 */

import type { StoredNote } from "./note";

export type NotesRepository = {
	listAll(): Promise<Map<string, StoredNote>>;
	save(note: StoredNote): Promise<void>;
	/** Patch only the denormalised body snippet for `id`. Used by the
	 *  background body migration so a concurrent user edit to other
	 *  fields (`values`, `title`, `icon`, `updatedAt`) is never clobbered
	 *  by the migration's stale captured-reference. Returns silently if
	 *  the row no longer exists. */
	patchBody(id: string, body: string): Promise<void>;
	remove(id: string): Promise<void>;
};
