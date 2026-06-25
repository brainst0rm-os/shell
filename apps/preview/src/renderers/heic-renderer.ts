/**
 * HEIC / HEIF renderer — 9.20.8 (tail).
 *
 * Chromium can't decode HEIC/HEIF natively, so an `<img>` just shows a
 * broken image. We decode to JPEG with libheif (via `heic-to`, lazy —
 * the wasm stays off Preview's cold-start path) and hand the result to
 * the existing image renderer, which gives HEIC the full pan / zoom /
 * rotate surface for free. A decode failure fails cleanly to the host's
 * "unavailable" pane.
 */

import { heicTo } from "heic-to";
import { t } from "../i18n";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewInstance, PreviewModule, PreviewMountContext } from "../types/preview-module";
import { imageRenderer } from "./image-renderer";
import { sourceBytes } from "./media-source";

export const heicRenderer: PreviewModule = {
	kind: PreviewKind.Heic,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		const bytes = await sourceBytes(context.source);
		// Fresh ArrayBuffer-backed copy so the Blob part is a concrete
		// ArrayBufferView<ArrayBuffer> (not a SharedArrayBuffer-backed view).
		const heicBytes = new Uint8Array(bytes.byteLength);
		heicBytes.set(bytes);
		let jpeg: Uint8Array;
		try {
			const blob = await heicTo({
				blob: new Blob([heicBytes], { type: context.source.mime }),
				type: "image/jpeg",
				quality: 0.92,
			});
			jpeg = new Uint8Array(await blob.arrayBuffer());
		} catch (err) {
			throw new Error(t("heic.decodeFailed"), { cause: err });
		}
		// Delegate to the image renderer — it owns the Blob/object-URL lifecycle
		// and every view control.
		return imageRenderer.mount({
			...context,
			source: { kind: "bytes", bytes: jpeg, mime: "image/jpeg" },
		});
	},
	extractMetadata(source) {
		return { Format: source.mime.toLowerCase().includes("heif") ? "HEIF" : "HEIC" };
	},
};
