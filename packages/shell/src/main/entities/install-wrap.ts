/**
 * Stage 10.14 — install an unwrapped per-entity DEK into the vault.
 *
 * Shared by every path that recovers a DEK from an inbound `WrapBootstrap`
 * frame: the dev collab bridge (`collab-dev-bridge.ts`), the always-on
 * `LiveSyncEngine` wiring (`index.ts`), and the restore engine
 * (`sync/restore-engine.ts`). Each previously open-coded the same seal +
 * persist + stamp body; this is the single source of truth.
 *
 * The caller has already HPKE-unwrapped the wrap with the device X25519
 * secret (that secret never leaves the `VaultSession`) and owns zeroing the
 * passed `dek` afterwards — this helper copies the bytes through
 * `EntityDekStore.persistWithDek` and zeroes its own copy.
 *
 * **Ordering**: the parent `entities` row MUST already exist — `entity_deks`
 * carries an `ON DELETE CASCADE` FK to `entities(id)`. Live sharing creates
 * the row up front (`installShareReceiver`); the restore path materializes it
 * from the wrap's recovered `type` before calling this.
 *
 * **Idempotent**: a re-delivered wrap for an entity that already holds its DEK
 * is a no-op (the `open` probe finds the existing row and returns).
 */

import type { EntitiesRepository } from "../storage/entities-repo";
import type { EntityDekStore } from "./entity-dek-store";

/**
 * Persist `dek` as `entityId`'s DEK (sealed under the vault master key) and
 * stamp `entities.dek_id`. No-op if a DEK is already installed for the entity.
 * The caller retains ownership of `dek` and must zero it.
 */
export function installEntityDek(
	entityId: string,
	dek: Uint8Array,
	dekStore: EntityDekStore,
	repo: EntitiesRepository,
): void {
	const existing = dekStore.open(entityId);
	if (existing) {
		dekStore.close(existing.dek);
		return;
	}
	const dekId = dekStore.nextDekId();
	const handle = dekStore.persistWithDek(entityId, dekId, dek);
	dekStore.close(handle.dek);
	repo.stampDekId(entityId, dekId);
}
