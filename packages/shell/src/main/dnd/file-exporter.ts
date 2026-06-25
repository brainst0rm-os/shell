/**
 * Drag-a-file-out binding (DND-5, §Part V — scope D). The one
 * native cross-boundary drag Electron supports is `webContents.startDrag`, which
 * carries a FILE + icon, nothing else. So a Files entry dragged to Finder is:
 * renderer reads the (decrypted) bytes → `dnd.exportFile({ name, bytes })` →
 * here we materialise them to a temp path and hand the OS drag to the app's
 * window.
 *
 * The fs + Electron specifics (temp write, window resolution, the drag icon) are
 * injected so the orchestration is unit-testable; `index.ts` supplies the real
 * bindings. SECURITY: `safeExportFilename` strips path separators / control
 * chars so a hostile `name` can't traverse out of the temp dir.
 */

import type { FileExporter } from "./dnd-service";

/** The drag handle the exporter drives — the structural subset of an Electron
 *  `WebContents` it needs (so tests pass a spy). */
export type DragStartTarget = {
	startDrag(item: { file: string; icon: unknown }): void;
};

export type FileExporterDeps = {
	/** The window that initiated the drag (the source app's webContents). */
	resolveWindow: (app: string) => DragStartTarget | null;
	/** Write `bytes` under a unique temp dir and return the absolute file path. */
	writeTemp: (filename: string, bytes: Uint8Array) => Promise<string>;
	/** The OS drag image (Electron throws on an empty icon). */
	dragIcon: () => unknown;
};

/** Basename only, control + reserved chars stripped, length-clamped, never empty
 *  — so the temp write can't escape its dir or be confused by a crafted name. */
const RESERVED_FILENAME_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*"]);
export function safeExportFilename(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? "";
	let out = "";
	for (const ch of base) {
		const code = ch.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) continue; // C0 / DEL controls
		if (RESERVED_FILENAME_CHARS.has(ch)) continue;
		out += ch;
	}
	out = out.replace(/^\.+/, "").trim().slice(0, 200).trim();
	return out.length > 0 ? out : "file";
}

export function createFileExporter(deps: FileExporterDeps): FileExporter {
	return async (app, { name, bytes }) => {
		const win = deps.resolveWindow(app);
		if (!win) return false;
		try {
			const path = await deps.writeTemp(safeExportFilename(name), bytes);
			win.startDrag({ file: path, icon: deps.dragIcon() });
			return true;
		} catch {
			return false;
		}
	};
}
