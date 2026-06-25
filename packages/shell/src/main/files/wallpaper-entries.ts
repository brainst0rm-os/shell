/**
 * listWallpaperEntries — enumerate the dashboard wallpaper store as
 * {@link FsStoreEntry} rows for the Files storage inventory. The wallpaper
 * store (unlike covers / icons) has no shared list helper — its only reader
 * was inline in the dashboard ipc handler — so this is the one home for
 * "what wallpapers are on disk", reused by the storage gatherer.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FsStoreEntry } from "./gather-storage-inventory";

const THUMB_SUFFIX = ".thumb.jpg";

export async function listWallpaperEntries(vaultPath: string): Promise<FsStoreEntry[]> {
	const dir = join(vaultPath, "dashboard", "wallpapers");
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const present = new Set(names);
	const out: FsStoreEntry[] = [];
	for (const name of names) {
		if (name.endsWith(THUMB_SUFFIX)) continue;
		const dot = name.lastIndexOf(".");
		const thumbName = `${name}${THUMB_SUFFIX}`;
		out.push({
			url: `brainstorm://wallpaper/${encodeURIComponent(name)}`,
			thumbUrl: present.has(thumbName)
				? `brainstorm://wallpaper/${encodeURIComponent(thumbName)}`
				: null,
			hash: dot >= 0 ? name.slice(0, dot) : name,
			uploadedAt: 0,
		});
	}
	return out;
}
