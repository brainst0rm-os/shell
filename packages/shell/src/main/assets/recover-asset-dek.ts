/**
 * Asset-B4 — recover a per-asset DEK for the materialise path.
 *
 * Two sources, tried in order:
 *   1. **Local master-key cache** (`asset_deks`) — present when this device
 *      minted the asset. Fast, no Y.Doc round-trip.
 *   2. **The re-homed wrap on the entity Y.Doc** (`brainstorm.meta → assetDeks`,
 *      Asset-B1) — the synced-device path: a device that fetched the blob's
 *      chunks but never had the master-key row opens the wrap with its own
 *      entity DEK.
 *
 * Returns a FRESH dek buffer the caller MUST zero after use (both paths copy /
 * mint so the store's own handle is closed here, never leaked). Returns null
 * when neither source can produce the key (the asset hasn't synced its DEK to
 * this device yet).
 */

import { type AssetDekWrap, openAssetDekUnderEntity } from "../credentials/asset-dek-wrap";
import type { EntityDekStore } from "../entities/entity-dek-store";
import type { AssetDekStore } from "./asset-dek-store";

export type RecoverAssetDekDeps = {
	assetDekStore: AssetDekStore;
	entityDekStore: EntityDekStore;
	/** Read the entity-DEK-sealed wrap off the entity Y.Doc (ydoc round-trip). */
	readAssetDekWrap: (entityId: string, assetId: string) => Promise<AssetDekWrap | null>;
};

export async function recoverAssetDek(
	deps: RecoverAssetDekDeps,
	entityId: string,
	assetId: string,
): Promise<Uint8Array | null> {
	// 1. Local master-key cache — copy out, then close the store's handle so the
	//    only live copy is the one the caller owns + zeroes.
	const local = deps.assetDekStore.open(assetId);
	if (local) {
		try {
			return new Uint8Array(local.dek);
		} finally {
			deps.assetDekStore.close(local.dek);
		}
	}

	// 2. Synced device — open the re-homed wrap with this device's entity DEK.
	const wrap = await deps.readAssetDekWrap(entityId, assetId);
	if (!wrap) return null;
	const entityHandle = deps.entityDekStore.open(entityId);
	if (!entityHandle) return null;
	try {
		return openAssetDekUnderEntity(wrap, entityHandle.dek, entityId, assetId);
	} finally {
		deps.entityDekStore.close(entityHandle.dek);
	}
}
