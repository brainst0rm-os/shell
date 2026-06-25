/**
 * Vault icon store — content-addressed user-uploaded image icons for the
 * universal icon model. Extracted
 * from `ipc/icons-handlers.ts` so BOTH the dashboard `icons:*` IPC and the
 * app-facing `icons` broker service (B11.14 custom emoji upload) share one
 * implementation rather than duplicating the sha + thumbnail logic.
 *
 * Storage layout:
 *   <vault>/icons/<sha256>.<ext>        ← original bytes (content-addressed)
 *   <vault>/icons/<sha256>.thumb.jpg    ← 64×64 thumbnail for the picker grid
 *
 * Served via the `brainstorm://icon/<file>` protocol; dedup is automatic
 * (same content → same hash → same filename).
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { nativeImage } from "electron";
import { type MediaSeal, VaultMediaDomain } from "../assets/vault-media-crypto";

const identityIconSeal: MediaSeal = (_relName, bytes) => bytes;

/** Build the Icon-domain at-rest seal from the active session (structural so
 *  this module needn't import `VaultSession`). */
export function iconSeal(session: {
	sealMedia(domain: VaultMediaDomain, relName: string, bytes: Uint8Array): Uint8Array;
}): MediaSeal {
	return (relName, bytes) => session.sealMedia(VaultMediaDomain.Icon, relName, bytes);
}

const THUMB_SUFFIX = ".thumb.jpg";
const THUMB_WIDTH = 64;
const THUMB_JPEG_QUALITY = 84;
const ICON_MAX_WIDTH = 512;

export const ALLOWED_ICON_EXTS: ReadonlySet<string> = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
	".svg",
]);

export type IconUploadResult = {
	url: string; // brainstorm://icon/<sha256>.<ext>
	thumbUrl: string; // brainstorm://icon/<sha256>.thumb.jpg
};

export type IconEntry = {
	url: string;
	thumbUrl: string;
	hash: string;
	uploadedAt: number;
};

export async function uploadIconBytes(
	vaultPath: string,
	bytes: Buffer,
	ext: string,
	seal: MediaSeal = identityIconSeal,
): Promise<IconUploadResult> {
	const dir = join(vaultPath, "icons");
	await mkdir(dir, { recursive: true });
	const hash = createHash("sha256").update(bytes).digest("hex");

	const targetName = `${hash}${ext}`;
	const targetPath = join(dir, targetName);
	const url = `brainstorm://icon/${encodeURIComponent(targetName)}`;
	const thumbName = `${hash}${THUMB_SUFFIX}`;
	const thumbUrl = `brainstorm://icon/${encodeURIComponent(thumbName)}`;

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
				img.getSize().width > ICON_MAX_WIDTH
					? img.resize({ width: ICON_MAX_WIDTH, quality: "good" })
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

export async function listIcons(vaultPath: string): Promise<IconEntry[]> {
	const dir = join(vaultPath, "icons");
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const out: IconEntry[] = [];
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
			url: `brainstorm://icon/${encodeURIComponent(name)}`,
			thumbUrl: `brainstorm://icon/${encodeURIComponent(`${hash}${THUMB_SUFFIX}`)}`,
			hash,
			uploadedAt: s.mtimeMs,
		});
	}
	out.sort((a, b) => b.uploadedAt - a.uploadedAt);
	return out;
}

export async function deleteIconByUrl(vaultPath: string, url: string): Promise<boolean> {
	const match = url.match(/^brainstorm:\/\/icon\/(.+)$/);
	if (!match || !match[1]) return false;
	const file = decodeURIComponent(match[1]);
	if (!/^[0-9a-f]{64}\.[a-z0-9]+$/.test(file)) return false;
	const dir = join(vaultPath, "icons");
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
