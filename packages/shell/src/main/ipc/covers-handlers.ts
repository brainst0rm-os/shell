/**
 * Cover-image content store (, B7.2).
 * ONE audited store, two entry points:
 *   - `registerCoversHandlers` — dashboard-trusted `covers:*` ipcMain
 *     handlers (Settings → Covers library; mirrors `icons-handlers.ts` /
 *     `dashboard-handlers.ts::uploadWallpaper`).
 *   - `coversStore` (uploadBytes / listCovers / deleteCoverByUrl) — the
 *     shared core the capability-gated `covers` broker service (B7.2c)
 *     calls, so apps and the dashboard hit identical validation, dedup,
 *     and path-traversal posture.
 *
 * Storage layout:
 *   <vault>/covers/<sha256>.<ext>           ← original bytes (content-addressed,
 *                                             downscaled to a cover band)
 *   <vault>/covers/<sha256>.thumb.jpg       ← card thumbnail
 *
 * Served from the renderer via the `brainstorm://cover/<file>` protocol
 * registered in `main/index.ts`. Dedup is automatic (same content → same
 * hash → same filename).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { type BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { type MediaSeal, VaultMediaDomain } from "../assets/vault-media-crypto";
import { getActiveVaultSession } from "../vault/session";

const THUMB_SUFFIX = ".thumb.jpg";
const THUMB_WIDTH = 320; // card thumbnail (matches the wallpaper gallery)
const THUMB_JPEG_QUALITY = 78;
const COVER_MAX_WIDTH = 1600; // covers are wide banners — keep a sane band, not full-res
const ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"]);
/** Pre-decode input ceiling. Originals are downscaled on disk, but the
 *  raw bytes are decoded into memory by `nativeImage` first — an
 *  unbounded app-supplied buffer is a memory-DoS vector over the broker.
 *  25 MiB is generous for any source a 1600px cover band needs. */
const MAX_COVER_BYTES = 25 * 1024 * 1024;

export type CoverUploadResult = {
	url: string; // brainstorm://cover/<sha256>.<ext>
	thumbUrl: string; // brainstorm://cover/<sha256>.thumb.jpg
};

export type CoverImageEntry = {
	url: string;
	thumbUrl: string;
	hash: string;
	uploadedAt: number;
};

/** Thrown when an upload is rejected for content reasons (bad ext / too
 *  large). `.name = "Invalid"` so the broker maps it to a clean
 *  client-visible error rather than a 500-ish Unavailable. */
export class CoverUploadRejected extends Error {
	constructor(message: string) {
		super(message);
		this.name = "Invalid";
	}
}

export type CoversHandlersOptions = {
	getDashboard: () => BrowserWindow | null;
};

export function registerCoversHandlers(options: CoversHandlersOptions): void {
	ipcMain.handle("covers:upload-from-dialog", async (): Promise<CoverUploadResult | null> => {
		const session = getActiveVaultSession();
		if (!session) throw new Error("covers:upload — no active vault session");
		const win = options.getDashboard();
		const result = win
			? await dialog.showOpenDialog(win, {
					title: "Choose cover image",
					properties: ["openFile"],
					filters: [
						{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"] },
					],
				})
			: await dialog.showOpenDialog({
					title: "Choose cover image",
					properties: ["openFile"],
					filters: [
						{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"] },
					],
				});
		if (result.canceled || result.filePaths.length === 0) return null;
		const sourcePath = result.filePaths[0];
		if (!sourcePath) return null;
		const bytes = await readFile(sourcePath);
		return uploadBytes(
			session.vaultPath,
			bytes,
			extname(sourcePath).toLowerCase(),
			coverSeal(session),
		);
	});

	ipcMain.handle(
		"covers:upload-bytes",
		async (_event, arg: { name: string; bytesBase64: string }): Promise<CoverUploadResult> => {
			const session = getActiveVaultSession();
			if (!session) throw new Error("covers:upload — no active vault session");
			const bytes = Buffer.from(arg.bytesBase64, "base64");
			return uploadBytes(
				session.vaultPath,
				bytes,
				extname(arg.name).toLowerCase(),
				coverSeal(session),
			);
		},
	);

	ipcMain.handle("covers:list", async (): Promise<CoverImageEntry[]> => {
		const session = getActiveVaultSession();
		if (!session) return [];
		return listCovers(session.vaultPath);
	});

	ipcMain.handle("covers:delete", async (_event, url: string): Promise<boolean> => {
		const session = getActiveVaultSession();
		if (!session) return false;
		return deleteCoverByUrl(session.vaultPath, url);
	});
}

/** The shared content-store core. Both the dashboard ipcMain handlers and
 *  the capability-gated `covers` broker service route through these so
 *  the validation + path posture is audited once. */
const identitySeal: MediaSeal = (_relName, bytes) => bytes;

/** Build the Cover-domain at-rest seal from the active session (structural so
 *  this module needn't import `VaultSession`). */
export function coverSeal(session: {
	sealMedia(domain: VaultMediaDomain, relName: string, bytes: Uint8Array): Uint8Array;
}): MediaSeal {
	return (relName, bytes) => session.sealMedia(VaultMediaDomain.Cover, relName, bytes);
}

export async function uploadBytes(
	vaultPath: string,
	bytes: Buffer,
	ext: string,
	seal: MediaSeal = identitySeal,
): Promise<CoverUploadResult> {
	if (!ALLOWED_EXTS.has(ext)) {
		throw new CoverUploadRejected(`covers:upload — unsupported file type: ${ext || "(none)"}`);
	}
	if (bytes.length === 0) {
		throw new CoverUploadRejected("covers:upload — empty file");
	}
	if (bytes.length > MAX_COVER_BYTES) {
		throw new CoverUploadRejected("covers:upload — file too large");
	}

	const dir = join(vaultPath, "covers");
	await mkdir(dir, { recursive: true });
	const hash = createHash("sha256").update(bytes).digest("hex");

	const targetName = `${hash}${ext}`;
	const targetPath = join(dir, targetName);
	const url = `brainstorm://cover/${encodeURIComponent(targetName)}`;
	const thumbName = `${hash}${THUMB_SUFFIX}`;
	const thumbUrl = `brainstorm://cover/${encodeURIComponent(thumbName)}`;

	// Write original (downscaled for raster, kept as-is for SVG since
	// nativeImage doesn't handle SVG sensibly).
	try {
		await stat(targetPath);
		// already uploaded — dedup
	} catch {
		if (ext === ".svg") {
			await writeFile(targetPath, seal(targetName, bytes));
		} else {
			const img = nativeImage.createFromBuffer(bytes);
			const downscaled =
				img.getSize().width > COVER_MAX_WIDTH
					? img.resize({ width: COVER_MAX_WIDTH, quality: "good" })
					: img;
			const out = ext === ".png" ? downscaled.toPNG() : downscaled.toJPEG(90);
			await writeFile(targetPath, seal(targetName, out));
		}
	}

	// Thumbnail — skip for SVG (renderer can render the SVG at any size).
	const thumbPath = join(dir, thumbName);
	try {
		await stat(thumbPath);
	} catch {
		if (ext !== ".svg") {
			const img = nativeImage.createFromBuffer(bytes);
			const thumb = img.resize({ width: THUMB_WIDTH, quality: "good" }).toJPEG(THUMB_JPEG_QUALITY);
			await writeFile(thumbPath, seal(thumbName, thumb));
		}
	}

	return { url, thumbUrl };
}

export async function listCovers(vaultPath: string): Promise<CoverImageEntry[]> {
	const dir = join(vaultPath, "covers");
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const out: CoverImageEntry[] = [];
	for (const name of entries) {
		if (name.endsWith(THUMB_SUFFIX)) continue;
		const ext = extname(name);
		const hash = name.slice(0, -ext.length);
		if (!/^[0-9a-f]{64}$/.test(hash)) continue;
		let s: Awaited<ReturnType<typeof stat>>;
		try {
			s = await stat(join(dir, name));
		} catch {
			continue;
		}
		out.push({
			url: `brainstorm://cover/${encodeURIComponent(name)}`,
			thumbUrl: `brainstorm://cover/${encodeURIComponent(`${hash}${THUMB_SUFFIX}`)}`,
			hash,
			uploadedAt: s.mtimeMs,
		});
	}
	out.sort((a, b) => b.uploadedAt - a.uploadedAt);
	return out;
}

export async function deleteCoverByUrl(vaultPath: string, url: string): Promise<boolean> {
	const match = url.match(/^brainstorm:\/\/cover\/(.+)$/);
	if (!match || !match[1]) return false;
	const file = decodeURIComponent(match[1]);
	// Allow-list: only `<sha256>.<ext>` — never a path, never `..`.
	if (!/^[0-9a-f]{64}\.[a-z0-9]+$/.test(file)) return false;
	const dir = join(vaultPath, "covers");
	const ext = extname(file);
	const hash = file.slice(0, -ext.length);
	try {
		await unlink(join(dir, file));
	} catch {
		return false;
	}
	await unlink(join(dir, `${hash}${THUMB_SUFFIX}`)).catch(() => undefined);
	return true;
}
