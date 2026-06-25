/**
 * Programmatic vault.json fixture builders for the 10.8 freeze test suite.
 *
 * Each helper writes a `vault.json` (and any required sibling files) at a
 * caller-provided temp path; tests mkdtemp + invoke + assert. No tarballs
 * are checked in — pre-freeze / future-major / hand-crafted shapes are
 * built at test time so a freeze-shape change inside `vault.json` is
 * caught by `tsc` here rather than via a stale fixture on disk.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FixtureVaultJson = Record<string, unknown>;

export type WriteFixtureOptions = {
	/** Override fields on the base fixture. Set a key to `undefined` to drop it. */
	override?: FixtureVaultJson;
};

/**
 * Canonical 1.0 (freeze) baseline. Drop / mutate via `override`.
 */
export function freezeFixture(): FixtureVaultJson {
	return {
		id: "vlt_test_freeze",
		name: "Freeze Test",
		color: "#7c3aed",
		format: "1.0",
		createdAt: 1_700_000_000_000,
	};
}

/** A pre-freeze (`0.9`) shape — the case the assert-not-pre-freeze guard rejects. */
export function preFreezeFixture(): FixtureVaultJson {
	return { ...freezeFixture(), id: "vlt_test_prefreeze", format: "0.9" };
}

/** A future-major (`2.0`) shape — the case `assertVaultFormatSupported` rejects. */
export function futureMajorFixture(): FixtureVaultJson {
	return { ...freezeFixture(), id: "vlt_test_future_major", format: "2.0" };
}

/** A future-minor (`1.5`) shape — opens via preserve-and-ignore. */
export function futureMinorFixture(): FixtureVaultJson {
	return { ...freezeFixture(), id: "vlt_test_future_minor", format: "1.5" };
}

export async function writeVaultJsonFixture(
	vaultPath: string,
	options: WriteFixtureOptions = {},
): Promise<{ vaultJson: FixtureVaultJson }> {
	const base = freezeFixture();
	const merged: FixtureVaultJson = { ...base };
	if (options.override) {
		for (const [key, value] of Object.entries(options.override)) {
			if (value === undefined) delete merged[key];
			else merged[key] = value;
		}
	}
	await mkdir(vaultPath, { recursive: true });
	await mkdir(join(vaultPath, "shell"), { recursive: true });
	await mkdir(join(vaultPath, "data"), { recursive: true });
	await mkdir(join(vaultPath, "data", "docs"), { recursive: true });
	await mkdir(join(vaultPath, "data", "attachments"), { recursive: true });
	await mkdir(join(vaultPath, "data", "app-private"), { recursive: true });
	await mkdir(join(vaultPath, "apps"), { recursive: true });
	await mkdir(join(vaultPath, "logs"), { recursive: true });
	await writeFile(join(vaultPath, "vault.json"), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
	return { vaultJson: merged };
}
