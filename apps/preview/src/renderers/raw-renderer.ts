/**
 * RAW image renderer — 9.20.11.
 *
 * Camera RAW (CR2 / NEF / ARW / DNG / ORF / RW2 …) is previewed by pulling
 * the embedded JPEG out of the TIFF container (`logic/raw-preview.ts`) and
 * handing it to the existing image renderer — so RAW inherits the full
 * pan / zoom / rotate / flip surface for free, with zero new bundle weight
 * (no WASM RAW decoder on the cold path). When no embedded preview exists
 * the renderer fails cleanly to the host's "unavailable" pane.
 */

import { t } from "../i18n";
import { extractEmbeddedJpeg, readRawInfo } from "../logic/raw-preview";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewInstance, PreviewModule, PreviewMountContext } from "../types/preview-module";
import { imageRenderer } from "./image-renderer";
import { sourceBytes } from "./media-source";

export const rawRenderer: PreviewModule = {
	kind: PreviewKind.Raw,
	async mount(context: PreviewMountContext): Promise<PreviewInstance> {
		const jpeg = extractEmbeddedJpeg(await sourceBytes(context.source));
		if (!jpeg) throw new Error(t("raw.noPreview"));
		// Delegate to the image renderer with the embedded JPEG as a bytes
		// source — it owns the Blob/object-URL lifecycle + all view controls.
		return imageRenderer.mount({
			...context,
			source: { kind: "bytes", bytes: jpeg, mime: "image/jpeg" },
		});
	},
	async extractMetadata(source) {
		const out: Record<string, string> = { Format: "RAW" };
		try {
			const { make, model } = readRawInfo(await sourceBytes(source));
			const camera = cameraLabel(make, model);
			if (camera) out.Camera = camera;
		} catch {
			// Camera id is decorative — a parse failure leaves just the Format row.
		}
		return out;
	},
};

/** "Canon Canon EOS R5" → "Canon EOS R5": models often repeat the make. */
function cameraLabel(make: string | undefined, model: string | undefined): string {
	const mk = make?.trim() ?? "";
	const md = model?.trim() ?? "";
	if (mk && md) return md.startsWith(mk) ? md : `${mk} ${md}`;
	return md || mk;
}
