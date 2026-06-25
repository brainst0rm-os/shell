/**
 * Registry rebuild-by-scan — recovery for the "Vault registry corrupted" row of
 * [ §Recovery scenarios] (iteration
 * 12.8). When `registry.json` is missing or unparseable, `readRegistry()`
 * degrades to an empty registry — the vaults on disk are intact but the shell
 * has forgotten where they are. This module rebuilds the list by scanning the
 * standard vault locations (+ any paths salvaged from the corrupt registry) for
 * directories that carry a valid `vault.json`.
 *
 * Per the doc's load-bearing decision — *"recovery operations always prompt
 * before mutating"* — this module is **read-only**: it returns the recoverable
 * `VaultEntry` candidates; it never writes `registry.json`. The vault-picker
 * surfaces them as an "Add back" offer (renderer half), so the user chooses
 * what to re-register. Nothing here mutates disk.
 *
 * The core (`scanForVaults`) is dependency-injected (directory listing + vault.json
 * read are passed in) so it's exercised entirely in-process without a real FS or
 * Electron; `productionScanForVaults` binds it to `node:fs`.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { defaultVaultRoot } from "./paths";
import type { VaultEntry } from "./registry";

/** The minimal on-disk `vault.json` fields a recovered registry entry needs.
 *  Mirrors the writer in `vault.ts` (`VaultJson`) — only the registry-relevant
 *  subset; unknown keys (atRestMode, identity*, syncRelay) are ignored here. */
type ScannedVaultJson = {
	id: string;
	name: string;
	color: string;
	icon?: string;
	format: string;
	createdAt?: number;
};

function isScannedVaultJson(value: unknown): value is ScannedVaultJson {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<ScannedVaultJson>;
	return (
		typeof v.id === "string" &&
		typeof v.name === "string" &&
		typeof v.color === "string" &&
		typeof v.format === "string"
	);
}

/**
 * Map a parsed `vault.json` (found at `path`) to a registry `VaultEntry`, or
 * `null` if the JSON isn't a recognizable vault manifest. `lastOpenedAt` is
 * unknown from disk alone (it lived in the lost registry), so it falls back to
 * the vault's `createdAt` — recovered vaults then sort by age rather than all
 * collapsing to epoch 0.
 */
export function vaultEntryFromVaultJson(path: string, parsed: unknown): VaultEntry | null {
	if (!isScannedVaultJson(parsed)) return null;
	return {
		id: parsed.id,
		name: parsed.name,
		color: parsed.color,
		...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
		path,
		lastOpenedAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
		format: parsed.format,
	};
}

export type ScanForVaultsOptions = {
	/** Directories whose immediate SUBDIRECTORIES are candidate vault roots
	 *  (e.g. `defaultVaultRoot()` — vaults live at `<root>/<name>/`). */
	readonly scanRoots: readonly string[];
	/** Directories that may THEMSELVES be vault roots — typically paths salvaged
	 *  from the corrupt registry ("known paths" in the doc). Checked directly. */
	readonly knownPaths: readonly string[];
	/** List a directory's immediate subdirectory paths. Returns `[]` for a
	 *  missing/unreadable directory (recovery is best-effort, never throws). */
	readonly listSubdirs: (dir: string) => Promise<readonly string[]>;
	/** Read + parse a candidate vault root's `vault.json`. Returns `null` when
	 *  the file is absent / unreadable / not JSON (the dir simply isn't a vault). */
	readonly readVaultJson: (vaultPath: string) => Promise<unknown | null>;
};

/**
 * Rebuild the vault list by scanning. Pure + dependency-injected. Collects every
 * directory carrying a valid `vault.json` from `knownPaths` (checked directly)
 * and the subdirectories of `scanRoots`, deduped by vault id (first-seen wins,
 * so a known-path entry beats a re-scan of the same vault). Best-effort: an
 * unreadable dir or a bad `vault.json` is skipped, never thrown.
 */
export async function scanForVaults(options: ScanForVaultsOptions): Promise<VaultEntry[]> {
	const { scanRoots, knownPaths, listSubdirs, readVaultJson } = options;

	const subdirLists = await Promise.all(scanRoots.map((root) => safeList(listSubdirs, root)));
	// `knownPaths` first so a salvaged registry entry wins the id-dedupe over a
	// fresh scan of the same vault directory.
	const candidates = [...knownPaths, ...subdirLists.flat()];

	const byId = new Map<string, VaultEntry>();
	for (const path of candidates) {
		const parsed = await safeRead(readVaultJson, path);
		if (parsed === null) continue;
		const entry = vaultEntryFromVaultJson(path, parsed);
		if (entry === null) continue;
		if (!byId.has(entry.id)) byId.set(entry.id, entry);
	}
	return [...byId.values()];
}

async function safeList(
	listSubdirs: ScanForVaultsOptions["listSubdirs"],
	dir: string,
): Promise<readonly string[]> {
	try {
		return await listSubdirs(dir);
	} catch {
		return [];
	}
}

async function safeRead(
	readVaultJson: ScanForVaultsOptions["readVaultJson"],
	path: string,
): Promise<unknown | null> {
	try {
		return await readVaultJson(path);
	} catch {
		return null;
	}
}

/**
 * Production binding: scan the OS-standard vault root (`defaultVaultRoot()`)
 * plus any `knownPaths` (the corrupt registry's salvageable entry paths) over
 * the real filesystem. Returns recoverable candidates for the vault-picker to
 * offer; writes nothing.
 */
export async function productionScanForVaults(
	knownPaths: readonly string[] = [],
): Promise<VaultEntry[]> {
	return scanForVaults({
		scanRoots: [defaultVaultRoot()],
		knownPaths,
		listSubdirs: async (dir) => {
			const entries = await readdir(dir, { withFileTypes: true });
			return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
		},
		readVaultJson: async (vaultPath) => {
			const raw = await readFile(join(vaultPath, "vault.json"), "utf8");
			return JSON.parse(raw) as unknown;
		},
	});
}
