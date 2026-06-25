/**
 * CLI: `bun --bun packages/shell/scripts/vault-validate.ts <vault-path>`
 *
 * Walks a vault on disk + prints the `ValidationReport` from
 * `validateVault`. Per OQ-217 the freeze ships CLI-only at 10.8 — the
 * IPC `shell.vault.validate` method lands when the Settings →
 * Diagnostics pane is designed. Per OQ-212 the report is warn-only;
 * the script always exits 0.
 *
 * This is **not** an Electron entry — it speaks pure node + bun, opens
 * the vault's SQLite + Y.Doc files directly (read-only), and prints
 * the report as a human-friendly table. Running it against an
 * encrypted-at-rest vault prints a structured "this vault was minted
 * encrypted; the CLI cannot decrypt without the master key" warning
 * and skips the SQL checks (the path is fenced inside `validateVault`).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { open as openSqlite } from "../src/main/storage/sqlite";
import { YDocStore } from "../src/main/storage/ydoc-store";
import { type ValidationWarning, validateVault } from "../src/main/vault/vault-validate";

type RawVaultJson = {
	id?: string;
	syncRelay?: { url?: unknown; addedAt?: unknown };
	atRestMode?: "encrypted" | "plaintext";
	identityPublicKey?: string;
};

async function main(): Promise<void> {
	const vaultPath = process.argv[2];
	if (!vaultPath) {
		console.error("usage: vault-validate.ts <vault-path>");
		process.exit(2);
	}
	const vaultJsonPath = join(vaultPath, "vault.json");
	let parsed: RawVaultJson;
	try {
		parsed = JSON.parse(await readFile(vaultJsonPath, "utf8")) as RawVaultJson;
	} catch (error) {
		console.error(`vault-validate: cannot read ${vaultJsonPath}: ${(error as Error).message}`);
		process.exit(2);
	}

	const syncRelayConfigured =
		parsed.syncRelay !== undefined &&
		typeof parsed.syncRelay.url === "string" &&
		typeof parsed.syncRelay.addedAt === "number";

	const entitiesDbPath = join(vaultPath, "data", "entities.db");
	let entityRows: { id: string; deleted: boolean }[] = [];
	let entityDeks: { entityId: string }[] = [];
	try {
		const db = await openSqlite(entitiesDbPath, { tunePragmas: false });
		try {
			entityRows = db
				.prepare("SELECT id, deleted_at FROM entities")
				.all()
				.map((r) => {
					const row = r as { id: string; deleted_at: number | null };
					return { id: row.id, deleted: row.deleted_at !== null };
				});
			entityDeks = db
				.prepare("SELECT entity_id FROM entity_deks")
				.all()
				.map((r) => ({ entityId: (r as { entity_id: string }).entity_id }));
		} finally {
			db.close();
		}
	} catch (error) {
		console.error(`vault-validate: cannot read entities.db: ${(error as Error).message}`);
	}

	const report = await validateVault(vaultPath, {
		entities: entityRows,
		entityDeks,
		deviceRecords: [],
		syncRelayConfigured,
		recordedAtRestMode: parsed.atRestMode,
		yDocStore: new YDocStore(vaultPath),
	});

	printReport(report.warnings);
	process.exit(0);
}

function printReport(warnings: readonly ValidationWarning[]): void {
	if (warnings.length === 0) {
		console.log("vault-validate: OK (no warnings)");
		return;
	}
	console.log(`vault-validate: ${warnings.length} warning(s)`);
	for (const w of warnings) {
		console.log(`  [${w.check}] ${w.detail} (fixable=${w.fixable})`);
	}
}

void main();
