/**
 * Repository plumbing shared by every app that persists owned entities —
 * first against the per-app `storage.kv` silo, then (Stage 9.3) against the
 * shared `entities.db`. The list→parse→drop-null read, the catch-and-log
 * write, and the get-then-create-or-update upsert were copy-pasted across
 * Bookmarks / Calendar / Tasks / Whiteboard; this is the single source.
 *
 * Two layers:
 *   - **Building blocks** (`listParsedRows`, `putRow`, `deleteRow`,
 *     `queryEntityRows`, `upsertEntity`, `deleteEntity`, `importKvRows`)
 *     — for apps with bespoke multi-type repositories (Tasks, Whiteboard)
 *     that compose them behind app-named methods + a combined query.
 *   - **Factories** (`createKvRepository`, `createEntityRepository`) — the
 *     single-entity shape (`listAll` / `save` / `remove`), used directly by
 *     Bookmarks and Calendar.
 *
 * Each caller passes its own `log` so the existing per-app message format
 * and level (Tasks' entities repo logs `console.error`; the rest `warn`)
 * are preserved exactly. The repo contract is "best-effort — the in-memory
 * state is the user-visible truth", so a read failure yields an empty list
 * and a write failure is swallowed (recoverable on the next write).
 */

export type RepoLogger = (op: string, err: unknown) => void;

export type KvRow = { key: string; value: unknown };

/** The slice of `storage.kv` a repository touches. */
export type KvStorage = {
	put(key: string, value: unknown): Promise<void>;
	list(prefix?: string): Promise<KvRow[]>;
	delete(key: string): Promise<unknown>;
};

/** List rows under `prefix`, parse each, drop the ones that don't validate.
 *  On a list failure: log and return `[]` (boot falls back to an empty
 *  vault rather than crashing the renderer). */
export async function listParsedRows<T>(
	storage: KvStorage,
	prefix: string,
	parse: (raw: unknown) => T | null,
	op: string,
	log: RepoLogger,
): Promise<T[]> {
	let rows: ReadonlyArray<{ value: unknown }>;
	try {
		rows = await storage.list(prefix);
	} catch (err) {
		log(op, err);
		return [];
	}
	const out: T[] = [];
	for (const row of rows) {
		const parsed = parse(row.value);
		if (parsed) out.push(parsed);
	}
	return out;
}

export async function putRow(
	storage: KvStorage,
	key: string,
	value: unknown,
	op: string,
	log: RepoLogger,
): Promise<void> {
	try {
		await storage.put(key, value);
	} catch (err) {
		log(op, err);
	}
}

export async function deleteRow(
	storage: KvStorage,
	key: string,
	op: string,
	log: RepoLogger,
): Promise<void> {
	try {
		await storage.delete(key);
	} catch (err) {
		log(op, err);
	}
}

export type EntityRow = {
	id: string;
	type: string;
	properties: Record<string, unknown>;
	/** Store-owned write timestamp — the entities service bumps it on every
	 *  write (any editor). Optional because some narrowed app-side service
	 *  types omit it; present on the real service. Repos may surface it as a
	 *  change-detection revision. */
	updatedAt?: number;
};

/** The slice of the shared entities service a repository touches. */
export type EntitiesLike = {
	get(id: string): Promise<EntityRow | null>;
	query(q: { type?: string | string[] }): Promise<EntityRow[]>;
	create(type: string, properties: Record<string, unknown>, id?: string): Promise<unknown>;
	update(id: string, patch: Record<string, unknown>): Promise<unknown>;
	delete(id: string): Promise<void>;
};

/** Query rows of `types` (a single type or a combined multi-type query).
 *  On failure: log and return `[]`. */
export async function queryEntityRows(
	entities: EntitiesLike,
	types: string | string[],
	op: string,
	log: RepoLogger,
): Promise<EntityRow[]> {
	try {
		return await entities.query({ type: types });
	} catch (err) {
		log(op, err);
		return [];
	}
}

/** Get-then-create-or-update keyed on the stable, app-owned id (passed
 *  through `create` so it survives the kv→shared transition). */
export async function upsertEntity(
	entities: EntitiesLike,
	type: string,
	id: string,
	props: Record<string, unknown>,
	op: string,
	log: RepoLogger,
): Promise<void> {
	try {
		const existing = await entities.get(id);
		if (existing) await entities.update(id, props);
		else await entities.create(type, props, id);
	} catch (err) {
		log(op, err);
	}
}

export async function deleteEntity(
	entities: EntitiesLike,
	id: string,
	op: string,
	log: RepoLogger,
): Promise<void> {
	try {
		await entities.delete(id);
	} catch (err) {
		log(op, err);
	}
}

/** One-time, idempotent bridge: copy `prefix`-keyed rows out of `kv.json`
 *  into the shared store via `save` (get-then-create-or-update keyed on the
 *  stable id, so re-running every boot is safe). Returns the count copied;
 *  best-effort (a list failure logs + returns 0). */
export async function importKvRows<T>(
	storage: { list(prefix?: string): Promise<KvRow[]> },
	prefix: string,
	parse: (raw: unknown) => T | null,
	save: (entity: T) => Promise<void>,
	op: string,
	log: RepoLogger,
): Promise<number> {
	let rows: ReadonlyArray<{ value: unknown }>;
	try {
		rows = await storage.list(prefix);
	} catch (err) {
		log(op, err);
		return 0;
	}
	let n = 0;
	for (const row of rows) {
		const parsed = parse(row.value);
		if (parsed) {
			await save(parsed);
			n += 1;
		}
	}
	return n;
}

/** The single-entity repository shape (`listAll` / `save` / `remove`) shared
 *  by the KV + entities factories below. */
export type SingleEntityRepository<T> = {
	listAll(): Promise<T[]>;
	save(entity: T): Promise<void>;
	remove(id: string): Promise<void>;
};

export type KvRepositoryConfig<T> = {
	keyPrefix: string;
	key: (id: string) => string;
	getId: (entity: T) => string;
	parse: (raw: unknown) => T | null;
	serialize: (entity: T) => unknown;
	log: RepoLogger;
};

/** Single-entity KV repository (Bookmarks, Calendar). */
export function createKvRepository<T>(
	storage: KvStorage,
	cfg: KvRepositoryConfig<T>,
): SingleEntityRepository<T> {
	return {
		listAll: () => listParsedRows(storage, cfg.keyPrefix, cfg.parse, "listAll", cfg.log),
		save: (entity) =>
			putRow(storage, cfg.key(cfg.getId(entity)), cfg.serialize(entity), "save", cfg.log),
		remove: (id) => deleteRow(storage, cfg.key(id), "remove", cfg.log),
	};
}

export type EntityRepositoryConfig<T> = {
	type: string;
	getId: (entity: T) => string;
	toProps: (entity: T) => Record<string, unknown>;
	fromEntity: (e: EntityRow) => T | null;
	log: RepoLogger;
};

/** Single-entity repository over the shared entities service (Bookmarks,
 *  Calendar). Filters the query result to `cfg.type` defensively. */
export function createEntityRepository<T>(
	entities: EntitiesLike,
	cfg: EntityRepositoryConfig<T>,
): SingleEntityRepository<T> {
	return {
		async listAll() {
			const rows = await queryEntityRows(entities, cfg.type, "listAll", cfg.log);
			const out: T[] = [];
			for (const row of rows) {
				if (row.type !== cfg.type) continue;
				const parsed = cfg.fromEntity(row);
				if (parsed) out.push(parsed);
			}
			return out;
		},
		save: (entity) =>
			upsertEntity(entities, cfg.type, cfg.getId(entity), cfg.toProps(entity), "save", cfg.log),
		remove: (id) => deleteEntity(entities, id, "remove", cfg.log),
	};
}
