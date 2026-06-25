/**
 * `bin:*` IPC handlers — surface the shell-only Bin / Trash (Stage 9.19)
 * to the privileged dashboard renderer.
 *
 * The Bin overlay is a privileged shell view (per OQ-BIN-1: restore /
 * purge write back into an app's data space, which a sandboxed app
 * cannot do), so it talks to ipcMain directly — never through the
 * broker. Mirrors the `marketplace:*` / `dashboard:*` patterns.
 *
 * After any mutation (restore / purge / empty) the handler fans out the
 * same refresh the entities service does on create/update/delete —
 * vault-entities staleness signal + search reindex + dashboard
 * re-publish — so a restored object reappears in its app and on any
 * pinned tile without the user touching anything. The fan-out is
 * injected (`afterMutation`) so this module stays decoupled from the
 * launcher / search-indexer wiring and is unit-testable.
 */

import { ipcMain } from "electron";
import {
	type BinItem,
	BinService,
	DEFAULT_BIN_RETENTION_DAYS,
	isBinRetentionDays,
} from "../bin/bin-service";
import type { EntitiesRepository } from "../storage/entities-repo";
import type { SettingsRepository } from "../storage/settings-repo";

export const BIN_LIST_CHANNEL = "bin:list" as const;
export const BIN_RESTORE_CHANNEL = "bin:restore" as const;
export const BIN_PURGE_CHANNEL = "bin:purge" as const;
export const BIN_EMPTY_CHANNEL = "bin:empty" as const;
export const BIN_GET_RETENTION_CHANNEL = "bin:get-retention" as const;
export const BIN_SET_RETENTION_CHANNEL = "bin:set-retention" as const;

/** The shell's own namespace inside the per-vault `settings.db` (the
 *  table is keyed `app_id` + `key`; apps can never reach this slice —
 *  the settings service stamps the broker-verified app id). */
const SHELL_SETTINGS_APP_ID = "io.brainstorm.shell";
const RETENTION_KEY = "bin.retentionDays";

export type BinHandlersOptions = {
	/** The active vault's `entities.db` repo, or null when no vault is
	 *  open (every verb degrades to empty/false — the Bin is just
	 *  unavailable, never an error). */
	getRepo: () => Promise<EntitiesRepository | null>;
	/** Free a purged upload's on-disk blob (resolves the active session's
	 *  asset store). Injected so this module stays decoupled from the vault
	 *  session; the GC reachability check itself lives in `BinService`. */
	deleteAsset: (assetId: string) => Promise<void>;
	/** The active vault's `settings.db` repo — carries the 9.8.8
	 *  retention-window preference. Optional so existing tests/wirings
	 *  stay valid; absent = retention pinned to the default. */
	getSettingsRepo?: () => Promise<SettingsRepository | null>;
	/** Called after a successful mutation so subscribers repaint:
	 *  vault-entities stale signal + search reindex + dashboard
	 *  re-publish. Injected to keep this module decoupled. */
	afterMutation: () => void;
};

/** Parse the persisted retention value; unknown / corrupt → default. */
export function parseRetentionDays(raw: string | null): number {
	if (raw === null) return DEFAULT_BIN_RETENTION_DAYS;
	try {
		const value: unknown = JSON.parse(raw);
		return isBinRetentionDays(value) ? value : DEFAULT_BIN_RETENTION_DAYS;
	} catch {
		return DEFAULT_BIN_RETENTION_DAYS;
	}
}

export function registerBinHandlers(options: BinHandlersOptions): void {
	const service = async (): Promise<BinService | null> => {
		const repo = await options.getRepo();
		if (!repo) return null;
		return new BinService({ getRepo: () => repo, deleteAsset: options.deleteAsset });
	};

	ipcMain.handle(BIN_LIST_CHANNEL, async (): Promise<BinItem[]> => {
		const svc = await service();
		if (!svc) return [];
		// 9.8.8 — lazy retention sweep on listing (the iOS pattern): items
		// past the window purge here, never from a background timer. The
		// sweep only runs when the policy store is wired — a legacy wiring
		// without `getSettingsRepo` must never destroy data on a read.
		const settingsRepo = await options.getSettingsRepo?.();
		if (settingsRepo) {
			const days = parseRetentionDays(settingsRepo.get(SHELL_SETTINGS_APP_ID, RETENTION_KEY));
			const swept = svc.purgeExpired(days);
			if (swept > 0) options.afterMutation();
		}
		return svc.list();
	});

	ipcMain.handle(BIN_GET_RETENTION_CHANNEL, async (): Promise<number> => {
		const repo = await options.getSettingsRepo?.();
		if (!repo) return DEFAULT_BIN_RETENTION_DAYS;
		return parseRetentionDays(repo.get(SHELL_SETTINGS_APP_ID, RETENTION_KEY));
	});

	ipcMain.handle(BIN_SET_RETENTION_CHANNEL, async (_event, days: unknown): Promise<number> => {
		const repo = await options.getSettingsRepo?.();
		if (!repo) return DEFAULT_BIN_RETENTION_DAYS;
		// Only the presets are accepted — fail-closed to the current value
		// (a hostile renderer can't disable retention with junk).
		if (isBinRetentionDays(days)) {
			repo.set(SHELL_SETTINGS_APP_ID, RETENTION_KEY, JSON.stringify(days));
			return days;
		}
		return parseRetentionDays(repo.get(SHELL_SETTINGS_APP_ID, RETENTION_KEY));
	});

	ipcMain.handle(BIN_RESTORE_CHANNEL, async (_event, id: unknown): Promise<boolean> => {
		const svc = await service();
		if (!svc) return false;
		const ok = svc.restore(typeof id === "string" ? id : "");
		if (ok) options.afterMutation();
		return ok;
	});

	ipcMain.handle(BIN_PURGE_CHANNEL, async (_event, id: unknown): Promise<boolean> => {
		const svc = await service();
		if (!svc) return false;
		const ok = await svc.purge(typeof id === "string" ? id : "");
		if (ok) options.afterMutation();
		return ok;
	});

	ipcMain.handle(BIN_EMPTY_CHANNEL, async (): Promise<number> => {
		const svc = await service();
		if (!svc) return 0;
		const purged = await svc.empty();
		if (purged > 0) options.afterMutation();
		return purged;
	});
}
