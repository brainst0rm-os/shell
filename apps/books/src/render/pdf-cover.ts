/**
 * Render a PDF's first page to PNG bytes for the cover-image store. Paints
 * page one onto an offscreen canvas through the same `PdfPagePort` the
 * reader uses (shared pdf.js engine — no second stack), then encodes it.
 * Returns `null` for an empty document or a host without a real canvas
 * (tests / SSR) — the caller treats that as "no cover this time", never an
 * error. The page-1 render runs alongside the reader's own paint on a
 * separate canvas; pdf.js serialises page access internally.
 */

import type { PdfPagePort } from "./pdf-reader";

/** Cover render box (CSS px). Generous enough that the host downscaler
 *  produces a crisp thumbnail; the cover store caps + dedups regardless. */
const COVER_MAX_WIDTH = 700;
const COVER_MAX_HEIGHT = 1000;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
	if (typeof canvas.toBlob !== "function") return Promise.resolve(null);
	return new Promise((resolve) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				resolve(null);
				return;
			}
			void blob
				.arrayBuffer()
				.then((buf) => resolve(new Uint8Array(buf)))
				.catch(() => resolve(null));
		}, "image/png");
	});
}

export async function renderPdfCover(port: PdfPagePort): Promise<Uint8Array | null> {
	if (port.pageCount <= 0 || typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	const handle = port.renderPage(0, canvas, COVER_MAX_WIDTH, COVER_MAX_HEIGHT);
	if (!handle) return null;
	try {
		await handle.promise;
	} catch {
		// A cancelled/failed render — no cover this time.
		return null;
	}
	return canvasToPng(canvas);
}
