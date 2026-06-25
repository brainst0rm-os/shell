/**
 * `VectorIndexer` — maintains one embedding per entity in a `VectorStore`,
 * in lockstep with the lexical (`SearchIndexer`) path. Sibling to
 * `SearchIndexer`, deliberately a separate class so the FTS path is
 * untouched and the vector path can be independently disabled when the
 * sqlite-vec extension fails to load.
 *
 * All reusable logic lives here (embed-text assembly, indexable filtering,
 * dimension fail-close, empty-query short-circuit) and is unit-tested
 * against `InMemoryVectorStore` + `StubEmbedder`; the production
 * `SqliteVecStore` is a thin SQL binding validated in real Electron.
 *
 * Async by design: the stub embeds synchronously, but 11.3's worker-computed
 * `multilingual-e5-small` is async — awaiting `embed()` now means the model
 * swap needs no caller reshape.
 */

import type { SqliteDatabase } from "../storage/sqlite";
import type { TextEmbedder } from "./embedder";
import { type IndexableEntity, isIndexable, pickIndexable } from "./search-indexer";
import { SqliteVecStore } from "./sqlite-vec-store";
import { type VectorHit, type VectorStore, clampK } from "./vector-store";

export type VectorSearchHit = VectorHit;

export class VectorIndexer {
	private readonly store: VectorStore;
	private readonly embedder: TextEmbedder;
	private disposed = false;

	constructor(store: VectorStore, embedder: TextEmbedder) {
		if (embedder.dim !== store.dim) {
			// Fail closed — an embedder/table dimension drift would write
			// truncated or rejected vectors and silently degrade recall.
			throw new Error(`VectorIndexer: embedder dim ${embedder.dim} != store dim ${store.dim}`);
		}
		this.store = store;
		this.embedder = embedder;
	}

	/** Upsert the entity's embedding, or drop it from the index when it is
	 *  no longer indexable (went blank) — mirrors how the lexical indexer
	 *  treats a now-empty entity. */
	async indexEntity(entity: IndexableEntity, now: number = Date.now()): Promise<void> {
		this.assertOpen();
		if (!isIndexable(entity)) {
			this.store.remove(entity.entityId);
			return;
		}
		const embedding = await this.embedder.embed(embedText(entity));
		this.store.upsert({
			entityId: entity.entityId,
			type: entity.type,
			ownerAppId: entity.ownerAppId,
			updatedAt: now,
			embedding,
		});
	}

	removeEntity(entityId: string): void {
		this.assertOpen();
		this.store.remove(entityId);
	}

	/** Atomically rebuild the whole vector index from sources. */
	async rebuild(entities: readonly IndexableEntity[], now: number = Date.now()): Promise<void> {
		this.assertOpen();
		const rows = [];
		for (const e of pickIndexable(entities)) {
			rows.push({
				entityId: e.entityId,
				type: e.type,
				ownerAppId: e.ownerAppId,
				updatedAt: now,
				embedding: await this.embedder.embed(embedText(e)),
			});
		}
		this.store.rebuild(rows);
	}

	/** Nearest-neighbour search for `text`. Empty / token-less queries embed
	 *  to a zero vector (no meaningful direction) → no hits, matching the
	 *  lexical indexer's empty-query short-circuit. */
	async query(text: string, k?: number, types?: readonly string[]): Promise<VectorSearchHit[]> {
		this.assertOpen();
		const embedding = await this.embedder.embed(text);
		if (isZero(embedding)) return [];
		return this.store.queryNearest(embedding, clampK(k), types);
	}

	count(): number {
		this.assertOpen();
		return this.store.count();
	}

	dispose(): void {
		this.disposed = true;
		this.store.dispose();
	}

	private assertOpen(): void {
		if (this.disposed) throw new Error("VectorIndexer: disposed");
	}
}

/** title + body, the same text the lexical index assembles, so the two
 *  indexes describe the same content. */
function embedText(entity: IndexableEntity): string {
	return `${entity.title}\n${entity.body}`.trim();
}

function isZero(v: Float32Array): boolean {
	for (const x of v) {
		if (x !== 0) return false;
	}
	return true;
}

/**
 * Construct the production vector indexer on `search.db`, or return `null`
 * when sqlite-vec can't load (bun:sqlite test runtime, or a platform
 * missing the prebuilt binary) — the caller then runs lexical-only. The
 * extension is loaded on the passed handle before the vec0 DDL runs in
 * `SqliteVecStore`'s constructor.
 */
export function createVectorIndexer(
	db: SqliteDatabase,
	embedder: TextEmbedder,
): { indexer: VectorIndexer; backend: "sqlite-vec" } | null {
	const loaded = db.loadVecExtension?.() ?? false;
	if (!loaded) return null;
	const store = new SqliteVecStore(db, embedder.dim);
	return { indexer: new VectorIndexer(store, embedder), backend: "sqlite-vec" };
}
