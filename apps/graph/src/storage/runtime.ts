/**
 * Bridge to the shell's app preload for the Graph entity-service surface
 * (9.13.2). Mirrors `apps/tasks/src/storage/runtime.ts` — types only the
 * slice this app uses — and `apps/journal/src/runtime.ts`'s shape for the
 * Y.Doc replica transport.
 *
 * `getGraphEntitiesRuntime()` returns null when:
 *   - the renderer boots outside the shell (vite preview / standalone dev), or
 *   - the shell hasn't yet exposed `services.entities` (older shell builds
 *     before the 9.3 entities service).
 *
 * In either case the existing `vaultEntities.list` + per-app `storage.kv`
 * persistence path stays the source of truth — the Graph entity-service
 * wiring is purely additive at 9.13.2 (load + render a saved `Graph/v1`).
 */

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

/** Y.Doc replica transport — base64 envelopes per the entities service
 *  (`packages/shell/src/main/entities/entities-service.ts`). Optional on
 *  the runtime: an older shell wires `entities` (CRUD) without the doc
 *  surface; we degrade by skipping the codec round-trip. */
export type EntitiesDocService = {
	loadDoc(id: string): Promise<{ snapshotB64?: string | null }>;
	applyDoc(id: string, updateB64: string): Promise<unknown>;
	closeDoc(id: string): Promise<unknown>;
};

/** Inbound update bridge — when another renderer / sync source applies a
 *  Y.Doc update to a Graph entity we have open, it lands here so the
 *  pattern can converge live. Same shape as Notes / Journal. */
export type YDocBridge = {
	onRemote(
		entityId: string,
		listener: (updateB64: string) => void,
	): { unsubscribe?: () => void } | (() => void);
};

/** The slice of `window.brainstorm.services` the Graph storage layer uses.
 *  Keeps this module decoupled from the larger `BrainstormRuntime` type
 *  declared inside `app.ts` — both can grow independently. */
export type GraphEntitiesRuntime = {
	entities?: EntitiesService & Partial<EntitiesDocService>;
	ydoc?: YDocBridge;
};

type WindowWithBrainstorm = {
	brainstorm?: {
		services?: {
			entities?: EntitiesService & Partial<EntitiesDocService>;
		};
		ydoc?: YDocBridge;
	};
};

export function getGraphEntitiesRuntime(): GraphEntitiesRuntime | null {
	if (typeof window === "undefined") return null;
	const bs = (window as unknown as WindowWithBrainstorm).brainstorm;
	if (!bs) return null;
	const entities = bs.services?.entities;
	if (!entities) return null;
	const runtime: GraphEntitiesRuntime = { entities };
	if (bs.ydoc) runtime.ydoc = bs.ydoc;
	return runtime;
}
