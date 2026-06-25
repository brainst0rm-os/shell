/**
 * Decrypt-on-read serving for the vault media protocols
 * (`brainstorm://cover|icon|wallpaper/...`) — OQ-240. DRYs what were three
 * byte-identical handlers in `index.ts` into one path, and adds the
 * decrypt step: a sealed blob is opened with the vault media key and served as
 * raw bytes; a legacy plaintext file (pre-migration) is streamed as-is. Path
 * traversal is rejected exactly as before (no `..`, must stay under the
 * domain's base dir).
 */

import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { net } from "electron";
import { type VaultMediaDomain, isSealedMedia } from "./vault-media-crypto";

const MEDIA_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".svg": "image/svg+xml",
};

/** The unseal capability the serve path needs — satisfied by `VaultSession`. */
export interface MediaUnsealer {
	openMedia(domain: VaultMediaDomain, relName: string, blob: Uint8Array): Uint8Array;
}

/** Resolve a media URL path to an absolute file under the domain's base dir, or
 *  an HTTP-ish status when it's rejected. Pure (no I/O) so it's unit-testable. */
export function resolveMediaTarget(
	vaultPath: string,
	domain: VaultMediaDomain,
	rawPath: string,
): { target: string; relName: string } | { status: number } {
	const relName = decodeURIComponent(rawPath.replace(/^\/+/, ""));
	if (!relName || relName.includes("..")) return { status: 400 };
	const base = join(vaultPath, domain);
	const target = normalize(join(base, relName));
	if (!target.startsWith(base + sep) && target !== base) return { status: 403 };
	return { target, relName };
}

/** Serve a vault media file: decrypt a sealed blob, or stream a legacy
 *  plaintext file unchanged. */
export async function serveVaultMedia(
	vaultPath: string,
	domain: VaultMediaDomain,
	rawPath: string,
	unsealer: MediaUnsealer,
): Promise<Response> {
	const resolved = resolveMediaTarget(vaultPath, domain, rawPath);
	if ("status" in resolved) return new Response(null, { status: resolved.status });
	let bytes: Buffer;
	try {
		bytes = await readFile(resolved.target);
	} catch {
		return new Response(null, { status: 404 });
	}
	const mime = MEDIA_MIME[extname(resolved.relName).toLowerCase()] ?? "application/octet-stream";
	if (isSealedMedia(bytes)) {
		try {
			const plain = unsealer.openMedia(domain, resolved.relName, bytes);
			return new Response(Buffer.from(plain), { headers: { "Content-Type": mime } });
		} catch {
			// Wrong key / tampered — never fall back to a raw read of ciphertext.
			return new Response(null, { status: 500 });
		}
	}
	// Legacy plaintext (pre-migration) — stream as-is; the open-time migration
	// re-seals it in place.
	return net.fetch(pathToFileURL(resolved.target).toString());
}
