/**
 * `windows:*` IPC handlers — surface the WindowIndex to the dashboard
 * renderer per §The window index.
 *
 * Privileged: only the dashboard renderer talks to these channels. App
 * renderers go through the broker (and the `shell.windows.*` capabilities are
 * shell-only, not granted to apps).
 */

import { type BrowserWindow, ipcMain } from "electron";
import type { LaunchSetup } from "../runtime/launch-setup";
import type { TilePreset } from "../window/tile";
import type { MonitorSummary, WindowEntry } from "../window/window-index";

export const WINDOWS_CHANGED_CHANNEL = "windows:changed" as const;

export type WindowsHandlersOptions = {
	launchSetup: LaunchSetup;
	getDashboard: () => BrowserWindow | null;
};

export function registerWindowsHandlers(options: WindowsHandlersOptions): void {
	const { launchSetup, getDashboard } = options;

	ipcMain.handle("windows:list", (): WindowEntry[] => {
		return launchSetup.getWindowIndexSync()?.list() ?? [];
	});

	ipcMain.handle("windows:list-monitors", (): MonitorSummary[] => {
		return launchSetup.getWindowIndexSync()?.monitors() ?? [];
	});

	ipcMain.handle("windows:focus", (_event, id: string): boolean => {
		return launchSetup.getWindowIndexSync()?.focus(id) ?? false;
	});

	ipcMain.handle("windows:minimize", (_event, id: string): boolean => {
		return launchSetup.getWindowIndexSync()?.minimize(id) ?? false;
	});

	ipcMain.handle("windows:close", (_event, id: string): boolean => {
		return launchSetup.getWindowIndexSync()?.close(id) ?? false;
	});

	ipcMain.handle(
		"windows:tile",
		(_event, id: string, preset: TilePreset, monitorId?: string): boolean => {
			return launchSetup.getWindowIndexSync()?.tile(id, preset, monitorId) ?? false;
		},
	);

	ipcMain.handle("windows:move-to-monitor", (_event, id: string, monitorId: string): boolean => {
		return launchSetup.getWindowIndexSync()?.moveToMonitor(id, monitorId) ?? false;
	});

	let detachIndexListener: (() => void) | null = null;

	function rebindIndex(): void {
		detachIndexListener?.();
		detachIndexListener = null;
		const index = launchSetup.getWindowIndexSync();
		if (!index) return;
		const broadcast = () => broadcastWindowsChangedToDashboard(getDashboard(), index.list());
		detachIndexListener = index.onChanged(broadcast);
		broadcast();
	}

	launchSetup.onSessionRebuilt(rebindIndex);
	rebindIndex();
}

/** Push the `windows:changed` snapshot to the dashboard renderer.
 *  Mirrors `broadcastStaleSignalToAppWindows` / `broadcastVaultEntitiesStaleSignal`
 *  — `BrowserWindow.isDestroyed()` can return false while the renderer's
 *  `WebFrameMain` is transiently disposed (during reload / navigation),
 *  so the inner `webContents.send` is guarded by both the destroyed-check
 *  AND a try/catch. Exported so tests can exercise the broadcast without
 *  spinning up the full handler registration. */
export function broadcastWindowsChangedToDashboard(
	dashboard: BrowserWindow | null,
	entries: WindowEntry[],
): void {
	if (!dashboard || dashboard.isDestroyed()) return;
	try {
		dashboard.webContents.send(WINDOWS_CHANGED_CHANNEL, entries);
	} catch (error) {
		console.warn("[brainstorm] windows:changed broadcast failed:", error);
	}
}
