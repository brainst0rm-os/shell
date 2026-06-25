/**
 * `icons:*` IPC handlers — the dashboard (privileged renderer) face of the
 * user-uploaded image-icon store (docs/foundations/39-universal-icons.md).
 * The store itself lives in `main/icons/icon-store.ts`, shared with the
 * app-facing `icons` broker service (B11.14).
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import {
	ALLOWED_ICON_EXTS,
	type IconEntry,
	type IconUploadResult,
	deleteIconByUrl,
	iconSeal,
	listIcons,
	uploadIconBytes,
} from "../icons/icon-store";
import { getActiveVaultSession } from "../vault/session";

export type { IconEntry, IconUploadResult } from "../icons/icon-store";

const DIALOG_FILTERS = [
	{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"] },
];

export type IconsHandlersOptions = {
	getDashboard: () => BrowserWindow | null;
};

export function registerIconsHandlers(options: IconsHandlersOptions): void {
	// Open a file dialog and upload the chosen file. Returns null on cancel.
	ipcMain.handle("icons:upload-from-dialog", async (): Promise<IconUploadResult | null> => {
		const session = getActiveVaultSession();
		if (!session) throw new Error("icons:upload — no active vault session");
		const win = options.getDashboard();
		const result = win
			? await dialog.showOpenDialog(win, {
					title: "Choose icon image",
					properties: ["openFile"],
					filters: DIALOG_FILTERS,
				})
			: await dialog.showOpenDialog({
					title: "Choose icon image",
					properties: ["openFile"],
					filters: DIALOG_FILTERS,
				});
		if (result.canceled || result.filePaths.length === 0) return null;
		const sourcePath = result.filePaths[0];
		if (!sourcePath) return null;
		const ext = extname(sourcePath).toLowerCase();
		if (!ALLOWED_ICON_EXTS.has(ext)) {
			throw new Error(`icons:upload — unsupported file type: ${ext}`);
		}
		const bytes = await readFile(sourcePath);
		return uploadIconBytes(session.vaultPath, bytes, ext, iconSeal(session));
	});

	// Renderer hands over bytes (drag-drop / paste / programmatic upload).
	ipcMain.handle(
		"icons:upload-bytes",
		async (_event, arg: { name: string; bytesBase64: string }): Promise<IconUploadResult> => {
			const session = getActiveVaultSession();
			if (!session) throw new Error("icons:upload — no active vault session");
			const ext = extname(arg.name).toLowerCase();
			if (!ALLOWED_ICON_EXTS.has(ext)) {
				throw new Error(`icons:upload — unsupported file type: ${ext}`);
			}
			const bytes = Buffer.from(arg.bytesBase64, "base64");
			return uploadIconBytes(session.vaultPath, bytes, ext, iconSeal(session));
		},
	);

	ipcMain.handle("icons:list", async (): Promise<IconEntry[]> => {
		const session = getActiveVaultSession();
		if (!session) return [];
		return listIcons(session.vaultPath);
	});

	ipcMain.handle("icons:delete", async (_event, url: string): Promise<boolean> => {
		const session = getActiveVaultSession();
		if (!session) return false;
		return deleteIconByUrl(session.vaultPath, url);
	});
}
