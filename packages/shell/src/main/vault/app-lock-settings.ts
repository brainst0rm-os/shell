/**
 * Per-vault app-lock preferences (Stage 13.8 surface) — currently the auto-lock
 * idle timeout. Stored at `<vaultPath>/shell/app-lock-settings.json`, the same
 * `shell/` convention `network-settings.json` / `shortcut-bindings.json` use.
 * Default-on-first-read: a missing/corrupt file returns (and rewrites) the
 * default so the next read is a clean parse. Pure I/O — fully testable.
 *
 * The PIN itself is NOT here — it's a keystore secret (`app-lock-pin.ts`). This
 * file only holds the non-secret "when to auto-lock" preference.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const APP_LOCK_SETTINGS_FILENAME = "app-lock-settings.json";

export type AppLockSettings = {
	/** Idle minutes before auto-lock; `0` = never (manual lock only). Also gates
	 *  the system-sleep / screen-lock triggers. */
	autoLockMinutes: number;
};

/** The values the Settings picker offers; the validator clamps to this set so a
 *  hand-edited file or stale renderer can't install a nonsense interval. */
export const AUTO_LOCK_CHOICES: readonly number[] = [0, 1, 5, 15, 30];
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

export function defaultAppLockSettings(): AppLockSettings {
	return { autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES };
}

export function validateAppLockSettings(value: unknown): AppLockSettings {
	if (value !== null && typeof value === "object" && "autoLockMinutes" in value) {
		const minutes = (value as { autoLockMinutes: unknown }).autoLockMinutes;
		if (typeof minutes === "number" && AUTO_LOCK_CHOICES.includes(minutes)) {
			return { autoLockMinutes: minutes };
		}
	}
	return defaultAppLockSettings();
}

export function appLockSettingsPath(vaultPath: string): string {
	return join(vaultPath, "shell", APP_LOCK_SETTINGS_FILENAME);
}

export async function readAppLockSettings(vaultPath: string): Promise<AppLockSettings> {
	try {
		const raw = await readFile(appLockSettingsPath(vaultPath), "utf8");
		return validateAppLockSettings(JSON.parse(raw));
	} catch {
		const fallback = defaultAppLockSettings();
		await writeAppLockSettings(vaultPath, fallback).catch(() => {});
		return fallback;
	}
}

export async function writeAppLockSettings(
	vaultPath: string,
	settings: AppLockSettings,
): Promise<void> {
	const path = appLockSettingsPath(vaultPath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(validateAppLockSettings(settings), null, 2), "utf8");
}
