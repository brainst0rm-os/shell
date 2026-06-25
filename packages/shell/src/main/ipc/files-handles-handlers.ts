/**
 * `files-handles:*` IPC handlers — the privileged dashboard surface that
 * powers the Settings → Security "Open files" panel (9.10).
 *
 * Apps never call these. Apps go through the broker (`files.requestOpen`
 * etc.); the dashboard renderer is the only renderer allowed to enumerate
 * + revoke live `FileHandle` tokens because it's the Settings UI.
 *
 * The list payload includes the (absolute) path so the user can see what
 * they're revoking — that's the whole point. The path is shell-trusted
 * data, never sent into a sandboxed app renderer (those receive only
 * `{ handleId, displayName }` from the broker).
 *
 * Change notifications: a separate `app:files-handles-changed` channel
 * pushes a payload-free staleness signal whenever the registry mutates,
 * so the panel re-`list`s through the authoritative path. Mirrors the
 * `app:vault-entities-changed` discipline (the broadcast carries authority
 * only, the snapshot still goes through the privileged accessor).
 */

import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
	type FileHandleInfo,
	FileHandleMode,
	type FileHandleRegistry,
} from "../files/file-handle-registry";
import { getActiveVaultSession, onActiveVaultSessionChanged } from "../vault/session";

/** Channel the dashboard preload listens on; payload-free. */
export const APP_FILES_HANDLES_CHANGED_CHANNEL = "app:files-handles-changed";

export type SerializedFileHandle = {
	handleId: string;
	appId: string;
	/** Absolute path. Shell-trusted UI only. */
	path: string;
	displayName: string;
	mode: "read" | "read-write";
	createdAt: number;
};

function serialize(info: FileHandleInfo): SerializedFileHandle {
	return {
		handleId: info.token,
		appId: info.appId,
		path: info.path,
		// Settings panel surfaces the basename next to the full path so
		// users see both the headline label and the disambiguator. The
		// basename derive is intentionally cheap — `node:path.basename`
		// would pull a dep into this file; the registry already exposes a
		// path-string, this is dashboard-side and only fires on registry
		// change.
		displayName: info.path.split(/[\\/]/).pop() ?? info.path,
		mode: info.mode === FileHandleMode.ReadWrite ? "read-write" : "read",
		createdAt: info.createdAt,
	};
}

export type FilesHandlesHandlersOptions = {
	/** The dashboard window — the only renderer that should receive the
	 *  change signal. Same pattern `properties-handlers.ts` uses. */
	getDashboard: () => BrowserWindow | null;
};

/**
 * Register the privileged surface + cross-vault subscription wiring.
 * Returns a disposer that unhooks the registry listener on shutdown /
 * vault close so a stale closure can't outlive its registry.
 */
export function registerFilesHandlesHandlers(options: FilesHandlesHandlersOptions): () => void {
	let unsubscribeRegistry: (() => void) | null = null;

	const subscribeToActive = (): void => {
		unsubscribeRegistry?.();
		unsubscribeRegistry = null;
		const session = getActiveVaultSession();
		if (!session) return;
		const registry: FileHandleRegistry = session.fileHandles;
		unsubscribeRegistry = registry.onChange(() => {
			const dashboard = options.getDashboard();
			if (!dashboard || dashboard.isDestroyed()) return;
			try {
				dashboard.webContents.send(APP_FILES_HANDLES_CHANGED_CHANNEL);
			} catch (error) {
				console.warn("[brainstorm] files-handles change broadcast failed:", error);
			}
		});
	};

	subscribeToActive();
	const unsubscribeSession = onActiveVaultSessionChanged(() => {
		subscribeToActive();
	});

	ipcMain.handle("files-handles:list", async (): Promise<SerializedFileHandle[]> => {
		const session = getActiveVaultSession();
		if (!session) return [];
		return session.fileHandles.list().map(serialize);
	});

	ipcMain.handle("files-handles:revoke", async (_event, handleId: string): Promise<boolean> => {
		const session = getActiveVaultSession();
		if (!session) return false;
		if (typeof handleId !== "string" || handleId.length === 0) return false;
		return session.fileHandles.revoke(handleId);
	});

	return () => {
		unsubscribeRegistry?.();
		unsubscribeSession();
		ipcMain.removeHandler("files-handles:list");
		ipcMain.removeHandler("files-handles:revoke");
	};
}
