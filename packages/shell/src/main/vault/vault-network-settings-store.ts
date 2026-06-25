/**
 * Net-1e — per-vault network-settings persistence.
 *
 * Stores the composite `VaultNetworkSettings` shape (privacy policy +
 * optional proxy override) at `<vaultPath>/shell/network-settings.json`,
 * the same `shell/` directory convention `shortcut-bindings.json` uses.
 * Default-on-first-read: if the file doesn't exist (or is corrupt /
 * unreadable), the store returns the default for the vault path and
 * writes it so the next read is a clean parse.
 *
 * Pure I/O — fully testable under Bun. The VaultSession owns the
 * lifecycle (lazy open + dispose); change broadcasts go through the
 * session's listener registration.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type VaultNetworkSettings,
	defaultVaultNetworkSettings,
	validateVaultNetworkSettings,
} from "../network/privacy-config";

export const NETWORK_SETTINGS_FILENAME = "network-settings.json";

/** Resolve the on-disk path. Same `<vault>/shell/<file>` convention the
 *  bindings store uses (per `shortcuts/bindings-store.ts`). */
export function networkSettingsPath(vaultPath: string): string {
	return join(vaultPath, "shell", NETWORK_SETTINGS_FILENAME);
}

/** Load the per-vault settings, applying the default-on-first-read
 *  contract. Returns the parsed settings on a clean read; the defaults
 *  for the path otherwise (and persists the defaults so the next read
 *  is a clean parse). Never throws — a file-system error becomes the
 *  defaults + a warn-log entry, so the network broker keeps working
 *  even when the vault's `shell/` dir is missing or unreadable. */
export async function readVaultNetworkSettings(vaultPath: string): Promise<VaultNetworkSettings> {
	try {
		const raw = await readFile(networkSettingsPath(vaultPath), "utf8");
		const parsed: unknown = JSON.parse(raw);
		const result = validateVaultNetworkSettings(parsed);
		if (result.ok) return result.settings;
		console.warn(
			`[brainstorm] network-settings.json invalid (${result.error}: ${result.detail}); reverting to defaults`,
		);
		const defaults = defaultVaultNetworkSettings(vaultPath);
		await writeVaultNetworkSettings(vaultPath, defaults);
		return defaults;
	} catch (error) {
		if (!isNotFound(error)) {
			console.warn("[brainstorm] network-settings.json read failed; reverting to defaults:", error);
		}
		const defaults = defaultVaultNetworkSettings(vaultPath);
		try {
			await writeVaultNetworkSettings(vaultPath, defaults);
		} catch (writeError) {
			console.warn("[brainstorm] network-settings.json initial write failed:", writeError);
		}
		return defaults;
	}
}

/** Persist `settings` atomically (write-then-rename via a temp path is
 *  overkill for this small file — a torn write becomes the next-read
 *  fallback to defaults, which is the safe direction). */
export async function writeVaultNetworkSettings(
	vaultPath: string,
	settings: VaultNetworkSettings,
): Promise<void> {
	const path = networkSettingsPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
