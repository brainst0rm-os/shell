/**
 * Welcome-1b-wire — the real binding that runs the idempotent starter-content
 * seeder against a live vault session during vault init.
 *
 * Builds the four `seedWelcomeContent` dependencies from the session:
 *   - `createEntity`  → a privileged `EntitiesRepository.create` (the shell
 *     vouches for its own seed; `dekId: null` like every other shell-internal
 *     bootstrap — the root-folder + kv-backfill rows — which the same
 *     vault-open pass retro-wraps via `runRetroWrapNullDeks`).
 *   - `plantBody`     → plant the bundled Lexical body into a fresh Y.Doc and
 *     persist it as a plaintext `applyUpdate` into the entity's universal-body
 *     doc (the ydoc worker store is crypto-free at 10.1).
 *   - `read/writeVersion` → the per-vault `welcome:seedVersion` stamp store.
 *
 * The caller (vault-init in `index.ts`) only invokes this on the open that
 * first created the vault root (`ensureRootFolder().created`), so an existing
 * vault is never seeded; the stamp is a second, idempotent guard. A
 * `createEntity` for an id that already exists is skipped, so a stamp-write
 * failure can't strand a half-seeded vault on the next attempt.
 */

import type { VaultSession } from "../vault/session";
import { type ApplyDocUpdate, makeSeedEntityDeps } from "./seed-deps";
import { type WelcomeSeedResult, seedWelcomeContent } from "./welcome-seed";
import { readWelcomeSeedVersion, writeWelcomeSeedVersion } from "./welcome-seed-store";

export type { ApplyDocUpdate } from "./seed-deps";

export type RunWelcomeSeedDeps = {
	/** The active vault session — narrowed to the slice the seed needs so the
	 *  in-process pipeline test can inject a `DataStores` + path without a
	 *  keystore / master key. */
	readonly session: Pick<VaultSession, "vaultPath" | "dataStores">;
	readonly applyDocUpdate: ApplyDocUpdate;
	/** Injected clock for deterministic tests; defaults to `Date.now()`. */
	readonly now?: number;
};

export async function runWelcomeSeed(deps: RunWelcomeSeedDeps): Promise<WelcomeSeedResult> {
	const vaultPath = deps.session.vaultPath;
	const seedDeps = await makeSeedEntityDeps(deps.session, deps.applyDocUpdate);
	return seedWelcomeContent({
		now: deps.now ?? Date.now(),
		...seedDeps,
		readVersion: () => readWelcomeSeedVersion(vaultPath),
		writeVersion: (version) => writeWelcomeSeedVersion(vaultPath, version),
	});
}
