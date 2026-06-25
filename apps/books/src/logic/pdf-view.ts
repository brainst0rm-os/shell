/**
 * PDF view settings — the fixed-layout analog of the reflow reader's
 * typography. A PDF owns its own layout, so font size / line spacing / measure
 * are meaningless here; what a reader can still adjust is the render *scale*
 * (zoom — the PDF analog of font size) and a page *tint* (light / sepia / dark)
 * applied as a canvas filter. Pure model: the surface paints from it, tests
 * step it directly.
 */

export enum PdfTint {
	Light = "light",
	Sepia = "sepia",
	Dark = "dark",
}

/** Picker order — light (no filter) first, then the two reading tints. */
export const PDF_TINT_ORDER: readonly PdfTint[] = [PdfTint.Light, PdfTint.Sepia, PdfTint.Dark];

export type PdfViewSettings = {
	/** Render scale as a whole percentage; 100 = fit-to-stage. */
	zoom: number;
	tint: PdfTint;
};

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 300;
export const ZOOM_STEP = 10;

export const DEFAULT_PDF_VIEW: PdfViewSettings = { zoom: 100, tint: PdfTint.Light };

function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return DEFAULT_PDF_VIEW.zoom;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom)));
}

/** Step zoom by `direction` (±1) × `ZOOM_STEP`, clamped to the supported range. */
export function stepZoom(settings: PdfViewSettings, direction: number): PdfViewSettings {
	const next = clampZoom(settings.zoom + Math.sign(direction) * ZOOM_STEP);
	return next === settings.zoom ? settings : { ...settings, zoom: next };
}

export function withTint(settings: PdfViewSettings, tint: PdfTint): PdfViewSettings {
	return tint === settings.tint ? settings : { ...settings, tint };
}

/** Multiplier the surface applies to the fit box (1 = fit-to-stage). */
export function zoomFactor(settings: PdfViewSettings): number {
	return clampZoom(settings.zoom) / 100;
}

/** Display string for the zoom value cell (e.g. `120%`). */
export function formatZoom(zoom: number): string {
	return `${clampZoom(zoom)}%`;
}
