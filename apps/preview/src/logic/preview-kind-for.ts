/**
 * `previewKindFor(mime)` — single source of truth for which renderer
 * module handles which MIME type. Used by:
 *
 *   - the manifest test (asserts every registered intent maps to a
 *     known PreviewKind);
 *   - the runtime module registry (`registry.ts`), to pick the loader
 *     once the host receives an `intent.open` / `quick-look` payload.
 *
 * Keystone: this function survives every renderer-iteration swap. It
 * has no React dep, no DOM dep — purely a string-in-enum-out resolver.
 *
 * **Not a giant switch.** The mapping lives as a const object keyed by
 * exact MIME first, then a prefix table for `image/*`, `video/*`,
 * `audio/*`, `text/*` so adding `.heic` post-v1 is a one-line change.
 *
 * Returns `null` when no renderer claims the MIME — the host then
 * shows a "no preview available" pane so unknown formats still open
 * cleanly via Preview's `intent.open` secondary registration.
 */

import { PreviewKind } from "../types/preview-kind";

/** Exact MIME → kind. Wins over the prefix table when both match. */
const EXACT_MIME: Readonly<Record<string, PreviewKind>> = {
	"application/pdf": PreviewKind.Pdf,
	"text/markdown": PreviewKind.Markdown,
	// `text/x-markdown` is a legacy mapping some servers still ship; treat as markdown.
	"text/x-markdown": PreviewKind.Markdown,
	// Code-ish text MIMEs are explicit so the Shiki renderer wins over the plain-text fallback.
	"application/javascript": PreviewKind.Code,
	"application/typescript": PreviewKind.Code,
	"application/json": PreviewKind.Code,
	"application/xml": PreviewKind.Code,
	"text/x-typescript": PreviewKind.Code,
	"text/x-python": PreviewKind.Code,
	"text/x-rust": PreviewKind.Code,
	"text/x-go": PreviewKind.Code,
	"text/css": PreviewKind.Code,
	"text/html": PreviewKind.Code,
	// 3D models (9.20.10) — glTF / GLB / OBJ. Wavefront OBJ has no IANA type,
	// so the de-facto ones are listed explicitly; the `model/` prefix below
	// future-proofs STL/PLY etc.
	"model/gltf-binary": PreviewKind.Model,
	"model/gltf+json": PreviewKind.Model,
	"model/obj": PreviewKind.Model,
	"text/prs.wavefront-obj": PreviewKind.Model,
	// Camera RAW (9.20.11). These are `image/x-*`, so they MUST be exact
	// entries to win over the `image/` prefix — the embedded-JPEG renderer
	// handles them, not the native <img> path.
	"image/x-canon-cr2": PreviewKind.Raw,
	"image/x-nikon-nef": PreviewKind.Raw,
	"image/x-sony-arw": PreviewKind.Raw,
	"image/x-adobe-dng": PreviewKind.Raw,
	"image/x-olympus-orf": PreviewKind.Raw,
	"image/x-panasonic-rw2": PreviewKind.Raw,
	"image/x-fuji-raf": PreviewKind.Raw,
	// Office OOXML (9.20.9) — Word / Excel / PowerPoint.
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": PreviewKind.Office,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": PreviewKind.Office,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": PreviewKind.Office,
	// HEIC / HEIF (9.20.8) — `image/*`, so EXACT entries to beat the image/
	// prefix; Chromium can't decode these, the libheif renderer handles them.
	"image/heic": PreviewKind.Heic,
	"image/heif": PreviewKind.Heic,
	"image/heic-sequence": PreviewKind.Heic,
	"image/heif-sequence": PreviewKind.Heic,
};

/** Prefix → kind. Last-resort match after exact + extension routing. */
const PREFIX_RULES: ReadonlyArray<{ prefix: string; kind: PreviewKind }> = [
	{ prefix: "image/", kind: PreviewKind.Image },
	{ prefix: "video/", kind: PreviewKind.Video },
	{ prefix: "audio/", kind: PreviewKind.Audio },
	{ prefix: "model/", kind: PreviewKind.Model },
	{ prefix: "text/", kind: PreviewKind.Text },
];

export function previewKindFor(mime: string): PreviewKind | null {
	if (!mime) return null;
	const normalised = mime.toLowerCase().split(";")[0]?.trim() ?? "";
	if (!normalised) return null;

	const exact = EXACT_MIME[normalised];
	if (exact !== undefined) return exact;

	for (const { prefix, kind } of PREFIX_RULES) {
		if (normalised.startsWith(prefix)) return kind;
	}
	return null;
}

/** Reverse map for tests + diagnostics — every MIME the manifest
 *  registers must resolve to one of these. Lists the *exact* MIMEs
 *  Preview's manifest enumerates so a test can iterate. */
export const REGISTERED_MIMES: ReadonlyArray<string> = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/svg+xml",
	"video/mp4",
	"video/webm",
	"video/quicktime",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
	"audio/flac",
	"text/plain",
	"text/markdown",
	"application/pdf",
	"model/gltf-binary",
	"model/gltf+json",
	"model/obj",
	"image/x-canon-cr2",
	"image/x-nikon-nef",
	"image/x-sony-arw",
	"image/x-adobe-dng",
	"image/x-olympus-orf",
	"image/x-panasonic-rw2",
	"image/x-fuji-raf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"image/heic",
	"image/heif",
];
