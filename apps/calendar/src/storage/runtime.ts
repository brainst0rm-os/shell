/**
 * Bridge to the shell's app preload — Calendar's own `storage.kv`
 * surface for `Event/v1` persistence. The `vaultEntities` surface
 * lives on a separate runtime adapter (`src/runtime.ts`) because the
 * two read different services and have distinct fallback semantics —
 * keeping them as sibling adapters keeps imports honest.
 */

type StorageValue = unknown;

export type StorageEntry = { key: string; value: StorageValue };

export type StorageService = {
	put(key: string, value: StorageValue): Promise<void>;
	get<T = StorageValue>(key: string): Promise<T | null>;
	list(prefix?: string): Promise<StorageEntry[]>;
	delete(key: string): Promise<boolean>;
};

/** The slice of the shared entities service Calendar uses (9.3.5.6).
 *  `Event/v1` has no rich text — no Y.Doc methods. `create` takes an
 *  optional caller id so an event keeps its stable id across the
 *  kv→shared transition. Mirrors `apps/bookmarks` / `apps/tasks`. */
export type EntityRecord = {
	id: string;
	type: string;
	properties: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
};

export type EntitiesService = {
	get(id: string): Promise<EntityRecord | null>;
	query(q: { type?: string | string[] }): Promise<EntityRecord[]>;
	create(type: string, properties: Record<string, unknown>, id?: string): Promise<EntityRecord>;
	update(id: string, patch: Record<string, unknown>): Promise<EntityRecord>;
	delete(id: string): Promise<void>;
};

/** Files-host handle + the slice of the service the ICS import/export
 *  flow needs (Stage 9.10; caps `files.read` / `files.write`). */
export type CalendarFileHandle = { handleId: string; displayName: string };

export type CalendarFilesFilter = { name: string; extensions: readonly string[] };

export type CalendarFilesService = {
	requestOpen(opts?: {
		title?: string;
		filters?: readonly CalendarFilesFilter[];
		multiple?: boolean;
	}): Promise<readonly CalendarFileHandle[]>;
	requestSave(opts?: {
		title?: string;
		suggestedName?: string;
		filters?: readonly CalendarFilesFilter[];
	}): Promise<CalendarFileHandle | null>;
	read(handle: CalendarFileHandle): Promise<Uint8Array>;
	write(handle: CalendarFileHandle, data: Uint8Array | ArrayBuffer): Promise<void>;
};

export type CalendarStorageBrainstorm = {
	services?: {
		storage?: StorageService;
		/** Present once the shell exposes the shared entities service.
		 *  When available Calendar reads/writes its `Event/v1` rows in the
		 *  shared object space (9.3.5.6) instead of its `kv.json` silo. */
		entities?: EntitiesService;
		/** Files-host service — ICS import/export saves/opens through it. */
		files?: CalendarFilesService;
	};
};

export function getStorageRuntime(): CalendarStorageBrainstorm | null {
	return (window as Window & { brainstorm?: CalendarStorageBrainstorm }).brainstorm ?? null;
}
