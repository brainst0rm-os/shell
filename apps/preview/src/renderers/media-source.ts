/**
 * Shared `PreviewSource` → media-element binding for the audio + video
 * renderers. Mirrors `image-renderer`'s `applySourceToImage`: a `url`
 * source is handed straight to the element; a `bytes` source becomes a
 * Blob object URL whose lifetime the renderer owns (returned so
 * `dispose()` can revoke it — never leak the URL).
 */

import type { PreviewSource } from "../types/preview-module";

/** Resolve a `PreviewSource` to its raw bytes — a `bytes` source is handed
 *  straight back; a `url` source is fetched. Shared by every renderer that
 *  needs the payload (PDF, Office, model, RAW, HEIC). */
export async function sourceBytes(source: PreviewSource): Promise<Uint8Array> {
	if (source.kind === "bytes") return source.bytes;
	const res = await fetch(source.url);
	return new Uint8Array(await res.arrayBuffer());
}

/** Like `sourceBytes`, but swallows a fetch failure and returns `null` —
 *  for decorative paths (metadata/EXIF) where a missing payload must never
 *  be fatal. */
export async function sourceBytesOrNull(source: PreviewSource): Promise<Uint8Array | null> {
	try {
		return await sourceBytes(source);
	} catch {
		return null;
	}
}

export function applySourceToMedia(el: HTMLMediaElement, source: PreviewSource): string | null {
	if (source.kind === "url") {
		el.src = source.url;
		return null;
	}
	const blob = new Blob([source.bytes as BlobPart], { type: source.mime });
	const url = URL.createObjectURL(blob);
	el.src = url;
	return url;
}
