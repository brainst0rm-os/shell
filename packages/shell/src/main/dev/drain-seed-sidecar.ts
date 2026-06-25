/**
 * Drain a pending seed sidecar into the active vault's `entities.db`.
 *
 * The out-of-process Bun seed-cli can't write an encrypted `entities.db`
 * (no SQLCipher under Bun), so it leaves the projected snapshot in a sidecar
 * (`writeSeedSidecar`). This runs in the Electron main process, where the
 * vault session holds the master key and the SQLCipher driver is live, and
 * applies the snapshot through the session's already-decrypted repo. Called
 * after a `dev:reseed-vault` and on dev boot so a bare-CLI reseed lands too.
 */

import { applySeederSnapshot, clearSeedSidecar, readSeedSidecar } from "../entities/seed-snapshot";
import { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import type { VaultSession } from "../vault/session";

export interface DrainResult {
	applied: boolean;
	entitiesCreated: number;
	entitiesUpdated: number;
	linksWritten: number;
	entitiesRemoved: number;
}

const EMPTY: DrainResult = {
	applied: false,
	entitiesCreated: 0,
	entitiesUpdated: 0,
	linksWritten: 0,
	entitiesRemoved: 0,
};

export async function drainSeedSidecar(session: VaultSession): Promise<DrainResult> {
	const snapshot = await readSeedSidecar(session.vaultPath);
	if (!snapshot) return EMPTY;
	const repo = new EntitiesRepository(await session.dataStores.open("entities"));
	// Apply first; only drop the sidecar once the snapshot is durably in
	// entities.db. A throw here (rolled-back txn) leaves the sidecar to retry.
	const stats = applySeederSnapshot(repo, snapshot, Date.now());
	await clearSeedSidecar(session.vaultPath);
	return { applied: true, ...stats };
}
