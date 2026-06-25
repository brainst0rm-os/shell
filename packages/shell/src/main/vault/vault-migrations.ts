/**
 * Forward-only vault.json migration scaffold (Stage 10.8).
 *
 * `vault.json.format` is **frozen at 1.0** in this iteration (per the
 * v1.0 freeze, §"Freeze
 * surface inventory at 10.8"). When a future iteration needs to bump the
 * shape — adding a required field, renaming an existing one — it appends
 * a `VaultMigration` here. The empty list at 10.8 is intentional: the
 * runner, the ordering invariant, the on-disk preserve-and-write pattern
 * and the backup-prompt seam are all in place so the **first real**
 * 1.0→1.1 migration is purely a content change.
 *
 * Ordering invariant: `VAULT_MIGRATIONS` is append-only and strictly
 * increasing (each entry's `to` is the next entry's `from`). Asserted on
 * load via `assertVaultMigrationsOrdered`.
 *
 * Each migration's `up` is responsible for **persisted side effects only**
 * — Yjs blobs, SQLite tables, dependent files. The runner itself owns
 * rewriting `vault.json` to bump the `format` field once `up` resolves
 * (using a parse-mutate-stringify pattern that preserves unknown
 * forward-compat keys — same shape `setSyncRelayConfig` / the at-rest
 * stamper already use). `up` must NOT rewrite `vault.json` itself.
 *
 * Concurrency: the migration runner is called from `openVault` /
 * `activateVault` BEFORE the at-rest reconcile, so there is no live
 * session and no IPC traffic in flight. A throw from any `up` aborts
 * the chain; partial-progress on earlier migrations stays on disk (the
 * format field gets bumped per-step). The next open re-enters the
 * runner at the new step.
 *
 * Pure module (no Electron imports); testable under Bun's vitest.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareDottedVersions } from "../util/schema-version";

export type VaultMigration = {
	from: string;
	to: string;
	description: string;
	/**
	 * Run the persisted side effects for this step. Receives the parsed
	 * (and possibly already-rewritten by a prior step) `vault.json`
	 * contents as a plain object — but does NOT need to write it back;
	 * the runner owns the `format` bump + on-disk rewrite.
	 *
	 * A throw aborts the chain; the format field will be at the previous
	 * step's `to` value on disk. Migrations should therefore be
	 * idempotent w.r.t. their own side effects when feasible.
	 */
	up: (vaultPath: string, parsedVaultJson: Record<string, unknown>) => Promise<void>;
};

/**
 * Append-only. v1.0 ships an empty list (the freeze itself is the
 * starting state). Adding a migration: push `{from: "1.0", to: "1.1",
 * description, up}` and update the freeze doc.
 */
export const VAULT_MIGRATIONS: readonly VaultMigration[] = [];

export type MigrateVaultResult = {
	from: string;
	to: string;
	applied: readonly VaultMigration[];
};

/**
 * Walk every `VaultMigration` whose `from` matches the current
 * `vault.json.format`, run its `up`, bump `format` to its `to` on
 * disk (preserve-and-write), and continue.
 *
 * Returns `{from, to, applied}` describing the chain. When the list is
 * empty or no migration matches, returns `{from: current, to: current,
 * applied: []}` without touching disk.
 *
 * Throws on any `up` failure, on a malformed `format` field, or on an
 * unordered migration list. Callers are expected to surface the error
 * (the boot-time open path already does — a malformed vault.json refuses
 * to open, see `openVault`).
 */
export async function migrateVaultToCurrent(
	vaultPath: string,
	currentVaultJson: Record<string, unknown>,
): Promise<MigrateVaultResult> {
	assertVaultMigrationsOrdered(VAULT_MIGRATIONS);

	const initialFormat = currentVaultJson.format;
	if (typeof initialFormat !== "string" || initialFormat.length === 0) {
		throw new Error("migrateVaultToCurrent: parsed vault.json has no string `format` field");
	}

	if (VAULT_MIGRATIONS.length === 0) {
		return { from: initialFormat, to: initialFormat, applied: [] };
	}

	const allowed = await promptBackupBeforeMigration(
		vaultPath,
		initialFormat,
		VAULT_MIGRATIONS[VAULT_MIGRATIONS.length - 1]?.to ?? initialFormat,
	);
	if (!allowed) {
		throw new Error(
			`migrateVaultToCurrent: backup-before-migrate prompt declined for vault ${vaultPath}`,
		);
	}

	const applied: VaultMigration[] = [];
	let currentFormat = initialFormat;
	const liveJson = currentVaultJson;
	for (const migration of VAULT_MIGRATIONS) {
		if (migration.from !== currentFormat) continue;
		await migration.up(vaultPath, liveJson);
		liveJson.format = migration.to;
		await rewriteVaultJsonPreservingShape(vaultPath, liveJson);
		applied.push(migration);
		currentFormat = migration.to;
	}
	return { from: initialFormat, to: currentFormat, applied };
}

/**
 * Backup-on-migrate prompt seam (OQ-214). At 10.8 the migration list is
 * empty, so this stub returns `true` immediately. When the first real
 * migration lands, the prompt is wired here — the surface is already
 * threaded into `migrateVaultToCurrent`'s call site so the activation is
 * a single-file change.
 *
 * Returning `false` aborts the migration chain (the runner throws so the
 * open path fails-loud rather than silently dropping the migration step).
 */
export async function promptBackupBeforeMigration(
	_vaultPath: string,
	_fromVersion: string,
	_toVersion: string,
): Promise<boolean> {
	if (VAULT_MIGRATIONS.length === 0) return true;
	return true;
}

/**
 * Strict-ordering check called on every runner entry. Asserts each
 * entry's `to` is strictly greater than its `from`, AND each entry's
 * `from` equals the previous entry's `to`. A future migration that
 * skips a version (e.g. `1.0`→`1.1` then `1.2`→`1.3`) would be caught
 * here — fix the list or insert the missing step.
 */
export function assertVaultMigrationsOrdered(migrations: readonly VaultMigration[]): void {
	for (let i = 0; i < migrations.length; i++) {
		const m = migrations[i];
		if (!m) continue;
		if (compareDottedVersions(m.from, m.to) >= 0) {
			throw new Error(`VAULT_MIGRATIONS[${i}]: from=${m.from} must be strictly less than to=${m.to}`);
		}
		if (i > 0) {
			const previous = migrations[i - 1];
			if (previous && previous.to !== m.from) {
				throw new Error(`VAULT_MIGRATIONS[${i}]: from=${m.from} must equal previous to=${previous.to}`);
			}
		}
	}
}

async function rewriteVaultJsonPreservingShape(
	vaultPath: string,
	parsedVaultJson: Record<string, unknown>,
): Promise<void> {
	const file = join(vaultPath, "vault.json");
	const raw = await readFile(file, "utf8");
	const onDisk = JSON.parse(raw) as Record<string, unknown>;
	for (const key of Object.keys(parsedVaultJson)) {
		onDisk[key] = parsedVaultJson[key];
	}
	await writeFile(file, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");
}
