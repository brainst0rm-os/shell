/**
 * Asset-B1 — open-time re-home pass for per-asset DEKs.
 *
 * The asset subsystem seals each blob under a fresh per-asset DEK and wraps
 * that DEK under the **vault master key** (`asset_deks`). That wrap is correct
 * for local-at-rest but cannot sync — the master key never leaves the device,
 * so a paired device that fetched the ciphertext blob couldn't open it.
 *
 * This pass re-homes the DEK onto the *syncable* plane: for every referencing
 * entity, it seals the same per-asset DEK under the **entity DEK** and installs
 * that wrap into the entity's Y.Doc (`brainstorm.meta → assetDeks`, keyed by
 * assetId). The local `asset_deks` master-key row is left in place — it becomes
 * a derived cache, not the source of truth (design [data/70]).
 *
 * Modeled on the 10.x retro-wrap null-DEK drain (`retro-wrap-deks.ts`):
 *
 *   - **Idempotent via the schema.** `asset_refs.rehomed_at` is the marker; the
 *     pass enumerates only NULL rows, so a steady-state vault runs one empty
 *     query. The worker install is independently idempotent (no-op on an
 *     assetId already on the doc), so a crash between install and stamp self-
 *     heals on the next boot.
 *   - **Per-pair isolation.** Any throw during one pair is logged + counted in
 *     `skipped`; the rest of the pass continues. One corrupt asset never blocks
 *     the others.
 *   - **Deferral, not failure, when a key is absent.** A pair whose entity DEK
 *     or asset DEK is not yet local (a pre-10.1 entity, or — forward — an asset
 *     whose bytes haven't synced down yet) is counted `deferred` and left
 *     UN-stamped, so a later boot retries once the key arrives. Non-syncable
 *     shell singletons (unsafe entity ids) can never carry a per-entity wrap,
 *     so they are stamped `localOnly` and never re-scanned.
 *   - **Key hygiene.** Every opened DEK handle is zeroed in a `finally`; the
 *     plaintext asset/entity DEKs never outlive the seal call.
 */

import type { AssetDekStore } from "../assets/asset-dek-store";
import { sealAssetDekUnderEntity } from "../credentials/asset-dek-wrap";
import type { AssetRefsRepository } from "../storage/entities-repo";
import { isSafeEntityId } from "../storage/entity-id";
import type { EntityDekStore } from "./entity-dek-store";

export type RehomeAssetDeksResult = {
	/** Pairs whose DEK is now wrapped under the entity DEK on the doc this pass
	 *  (a fresh install or a confirmed-already-present idempotent no-op). */
	rehomed: number;
	/** Pairs an entity/asset DEK was not available for — left un-stamped so a
	 *  later boot retries when the key materializes. */
	deferred: number;
	/** Non-syncable shell singletons (unsafe entity ids) — stamped so they are
	 *  never re-scanned; their master-key wrap stays authoritative. */
	localOnly: number;
	/** Pairs the pass tried to re-home but errored (per-pair error logged; the
	 *  pass continued). */
	skipped: number;
};

export type RehomeAssetDeksOptions = {
	assetRefs: AssetRefsRepository;
	assetDekStore: AssetDekStore;
	entityDekStore: EntityDekStore;
	/** Seal the wrap into the referencing entity's Y.Doc (ydoc worker round-
	 *  trip). Idempotent; the `appended` flag is informational — either way the
	 *  wrap is on the doc once this resolves. */
	installAssetDekWrap: (
		entityId: string,
		assetId: string,
		wrap: ReturnType<typeof sealAssetDekUnderEntity>,
	) => Promise<{ appended: boolean }>;
	now?: () => number;
};

/**
 * Drain every `asset_refs` pair with `rehomed_at IS NULL` by installing the
 * entity-DEK-sealed asset wrap on the entity's Y.Doc and stamping the marker.
 * Returns the per-pass tally; a boot log surfaces it.
 */
export async function rehomeAssetDeks(
	opts: RehomeAssetDeksOptions,
): Promise<RehomeAssetDeksResult> {
	const { assetRefs, assetDekStore, entityDekStore, installAssetDekWrap } = opts;
	const now = opts.now ?? (() => Date.now());
	const result: RehomeAssetDeksResult = { rehomed: 0, deferred: 0, localOnly: 0, skipped: 0 };

	let pairs: ReturnType<AssetRefsRepository["listUnrehomedPairs"]>;
	try {
		pairs = assetRefs.listUnrehomedPairs();
	} catch (error) {
		// A failed listing must not abort vault open — log + return zeros.
		console.warn(`[rehome-asset-deks] list failed, skipping pass: ${(error as Error).message}`);
		return result;
	}

	for (const { entityId, assetId } of pairs) {
		try {
			// Shell-internal singletons carry non-safe ids; the sync wire path
			// rejects those at its trust boundary, so they are local-only by
			// construction and can neither need nor receive a per-entity wrap.
			// Stamp them so the pass never reconsiders the row.
			if (!isSafeEntityId(entityId)) {
				assetRefs.markRehomed(entityId, assetId, now());
				result.localOnly += 1;
				continue;
			}

			const entityHandle = entityDekStore.open(entityId);
			if (!entityHandle) {
				// No per-entity DEK yet (pre-10.1 / not retro-wrapped this boot).
				// Retry next boot; the retro-wrap pass runs first in production.
				result.deferred += 1;
				continue;
			}
			try {
				const assetHandle = assetDekStore.open(assetId);
				if (!assetHandle) {
					// The local master-key DEK is gone (or — forward — the asset's
					// bytes haven't synced down). Defer; do not stamp.
					result.deferred += 1;
					continue;
				}
				try {
					const wrap = sealAssetDekUnderEntity(assetHandle.dek, entityHandle.dek, entityId, assetId);
					await installAssetDekWrap(entityId, assetId, wrap);
					assetRefs.markRehomed(entityId, assetId, now());
					result.rehomed += 1;
				} finally {
					assetDekStore.close(assetHandle.dek);
				}
			} finally {
				entityDekStore.close(entityHandle.dek);
			}
		} catch (error) {
			result.skipped += 1;
			console.warn(
				`[rehome-asset-deks] entity ${entityId} asset ${assetId} failed: ${(error as Error).message}`,
			);
		}
	}
	return result;
}
