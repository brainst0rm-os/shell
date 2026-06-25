/**
 * Pure filmstrip-thumb helpers — map a file's MIME to the swatch class /
 * typed glyph the strip shows for non-image kinds, and (for images) mint /
 * cache / release the blob: URLs the thumbnails need. Framework-free so the
 * mapping is unit-tested without a DOM; the React `<Filmstrip>` consumes it.
 */

import type { PreviewFile } from "../demo/dataset";
import { previewKindFor } from "../logic/preview-kind-for";
import { PreviewKind } from "../types/preview-kind";

export function kindClassFor(mime: string): string {
	switch (previewKindFor(mime)) {
		case PreviewKind.Image:
			return "image";
		case PreviewKind.Video:
			return "video";
		case PreviewKind.Audio:
			return "audio";
		case PreviewKind.Markdown:
			return "markdown";
		case PreviewKind.Code:
			return "code";
		case PreviewKind.Pdf:
			return "pdf";
		default:
			return "text";
	}
}

export function kindGlyphFor(mime: string): string {
	switch (previewKindFor(mime)) {
		case PreviewKind.Image:
			return "Im";
		case PreviewKind.Video:
			return "Vi";
		case PreviewKind.Audio:
			return "Au";
		case PreviewKind.Markdown:
			return "Md";
		case PreviewKind.Code:
			return "Co";
		case PreviewKind.Pdf:
			return "Pd";
		default:
			return "Tx";
	}
}

/**
 * Per-session cache of `blob:` URLs minted for `bytes`-mode image sources so
 * the filmstrip can show real thumbnails. Keyed by file id; `releaseAll`
 * revokes them en-masse when the sibling list changes so a long-running
 * session doesn't leak blobs.
 */
export class ThumbUrlCache {
	private readonly urls = new Map<string, string>();

	urlFor(file: PreviewFile): string | null {
		if (previewKindFor(file.info.mime) !== PreviewKind.Image) return null;
		const source = file.source;
		if (source.kind === "url") return source.url;
		const cached = this.urls.get(file.id);
		if (cached) return cached;
		try {
			const blob = new Blob([source.bytes as BlobPart], { type: source.mime });
			const url = URL.createObjectURL(blob);
			this.urls.set(file.id, url);
			return url;
		} catch {
			return null;
		}
	}

	releaseAll(): void {
		for (const url of this.urls.values()) {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// Revocation is best-effort — the browser owns URL validity.
			}
		}
		this.urls.clear();
	}
}
