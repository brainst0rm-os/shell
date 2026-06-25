/**
 * Welcome-1b — per-vault "starter content already seeded" stamp.
 *
 * Holds the last-seeded `WELCOME_SEED_VERSION` at
 * `<vaultPath>/shell/welcome-seed.json`, the same `<vault>/shell/<file>`
 * convention `network-settings.json` + `shortcut-bindings.json` use. The
 * seeder reads the stamp and skips when it already covers the bundled
 * version, so the starter set is planted exactly once per vault and never
 * re-appears after the user edits or bins it.
 *
 * Pure I/O, fully testable under Bun. Never throws — a missing or corrupt
 * file reads as "never seeded" (version 0), which is the safe direction (at
 * worst the seeder runs once more and overwrites in place by stable id).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const WELCOME_SEED_FILENAME = "welcome-seed.json";

/** `<vault>/shell/welcome-seed.json`. */
export function welcomeSeedStampPath(vaultPath: string): string {
	return join(vaultPath, "shell", WELCOME_SEED_FILENAME);
}

/** The last-seeded version for this vault, or `0` when never seeded /
 *  unreadable / corrupt. */
export async function readWelcomeSeedVersion(vaultPath: string): Promise<number> {
	try {
		const raw = await readFile(welcomeSeedStampPath(vaultPath), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && "seedVersion" in parsed) {
			const v = (parsed as { seedVersion: unknown }).seedVersion;
			if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
		}
		return 0;
	} catch (error) {
		if (!isNotFound(error)) {
			console.warn("[brainstorm] welcome-seed.json read failed; treating as unseeded:", error);
		}
		return 0;
	}
}

/** Persist the seeded version. A torn write reads back as `0` (re-seed,
 *  overwrite-in-place by stable id) — the safe direction. */
export async function writeWelcomeSeedVersion(vaultPath: string, version: number): Promise<void> {
	const path = welcomeSeedStampPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ seedVersion: version }, null, 2)}\n`, "utf8");
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "ENOENT"
	);
}
