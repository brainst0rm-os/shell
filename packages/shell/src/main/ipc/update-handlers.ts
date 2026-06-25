/**
 * 13.6 — privileged `update:*` IPC (manual-download update check).
 *
 * Dashboard-only, talks to ipcMain directly (like `vault:*` / `dashboard:*`)
 * — updating is an app-global concern, not a per-app brokered capability.
 * The handlers are thin: every decision lives in the injected
 * `UpdateService` so this file stays IO-free and the service stays the one
 * tested unit.
 */

import { ipcMain } from "electron";
import {
	type UpdateCheckResult,
	type UpdatePrefs,
	toUpdateChannel,
} from "../../shared/update-wire-types";
import type { UpdateService } from "../update/update-service";

export function registerUpdateHandlers(service: UpdateService): void {
	ipcMain.handle("update:check", async (): Promise<UpdateCheckResult> => await service.check());
	ipcMain.handle("update:get-prefs", async (): Promise<UpdatePrefs> => await service.getPrefs());
	ipcMain.handle(
		"update:set-channel",
		async (_event, channel: unknown): Promise<UpdatePrefs> =>
			await service.setChannel(toUpdateChannel(channel)),
	);
}
