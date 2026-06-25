/**
 * AssetRefsRepository — CRUD on `entities.db`'s `asset_refs` table (binary-
 * asset subsystem). Per the Stage 5 repository-pattern decision, all SQL for
 * the table lives here.
 *
 * Each row binds one asset to one owning entity under a role
 * (favicon/cover/inline). The `entity_id` FK is `ON DELETE CASCADE`, so
 * hard-deleting the owner drops its refs and the GC sweep can reclaim a
 * now-unreferenced asset. `countByAsset` is the GC reachability test.
 */

import type { AssetRefRole } from "../../assets/asset-types";
import type { SqliteDatabase, SqliteStatement } from "../sqlite";

export type AssetRefRecord = {
	entityId: string;
	assetId: string;
	role: AssetRefRole;
	createdAt: number;
};

export type CreateAssetRefInput = {
	entityId: string;
	assetId: string;
	role: AssetRefRole;
	now: number;
};

type DbAssetRefRow = {
	entity_id: string;
	asset_id: string;
	role: string;
	created_at: number;
};

export class AssetRefsRepository {
	private readonly statements = new Map<string, SqliteStatement>();

	constructor(private readonly db: SqliteDatabase) {}

	private stmt(sql: string): SqliteStatement {
		const cached = this.statements.get(sql);
		if (cached) return cached;
		const prepared = this.db.prepare(sql);
		this.statements.set(sql, prepared);
		return prepared;
	}

	/** Idempotent on the (entity, asset, role) primary key — re-binding the
	 *  same role replaces nothing and is a no-op rather than an error. */
	create(input: CreateAssetRefInput): void {
		this.stmt(
			"INSERT OR IGNORE INTO asset_refs (entity_id, asset_id, role, created_at) VALUES (?, ?, ?, ?)",
		).run(input.entityId, input.assetId, input.role, input.now);
	}

	listByEntity(entityId: string): AssetRefRecord[] {
		const rows = this.stmt(
			"SELECT entity_id, asset_id, role, created_at FROM asset_refs WHERE entity_id = ?",
		).all(entityId) as DbAssetRefRow[];
		return rows.map(rowToRecord);
	}

	listByAsset(assetId: string): AssetRefRecord[] {
		const rows = this.stmt(
			"SELECT entity_id, asset_id, role, created_at FROM asset_refs WHERE asset_id = ?",
		).all(assetId) as DbAssetRefRow[];
		return rows.map(rowToRecord);
	}

	/** Reachability count for GC — how many entities still reference this
	 *  asset. Zero ⇒ collectible. */
	countByAsset(assetId: string): number {
		const row = this.stmt("SELECT count(*) AS n FROM asset_refs WHERE asset_id = ?").get(assetId) as {
			n: number;
		};
		return Number(row.n);
	}

	deleteByEntity(entityId: string): number {
		const result = this.stmt("DELETE FROM asset_refs WHERE entity_id = ?").run(entityId);
		return Number(result.changes);
	}
}

function rowToRecord(row: DbAssetRefRow): AssetRefRecord {
	return {
		entityId: row.entity_id,
		assetId: row.asset_id,
		role: row.role as AssetRefRole,
		createdAt: row.created_at,
	};
}
