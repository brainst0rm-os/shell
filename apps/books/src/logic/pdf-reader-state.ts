/**
 * PDF reading-mode state (9.21.5) — pure page navigation for a fixed-layout
 * book. Unlike the reflow reader there is no chars-per-page budget: the PDF
 * itself owns its page breaks, so a "page" IS a spine item and the stable
 * locator for a position is simply `{ spineIndex: pageIndex, charOffset: 0 }`.
 * That keeps `Book/v1.reading.position` one shape across both formats — the
 * library + persistence layers never branch on format.
 */

import { type Locator, makeLocator } from "../types/locator";

export type PdfReaderState = {
	/** 0-based current page. */
	pageIndex: number;
	/** Total pages (0 for a not-yet-loaded / empty document). */
	pageCount: number;
};

function clampPageIndex(pageIndex: number, pageCount: number): number {
	if (pageCount <= 0) return 0;
	if (!Number.isFinite(pageIndex)) return 0;
	return Math.min(pageCount - 1, Math.max(0, Math.floor(pageIndex)));
}

/** Map a parked locator back to its page. Out-of-range spine indices clamp
 *  (a book shrunk by re-import still opens). */
export function pageIndexFromLocator(locator: Locator | null, pageCount: number): number {
	if (!locator) return 0;
	return clampPageIndex(locator.spineIndex, pageCount);
}

export function createPdfReaderState(
	pageCount: number,
	initialPosition: Locator | null = null,
): PdfReaderState {
	const total = Math.max(0, Math.floor(pageCount));
	return { pageIndex: pageIndexFromLocator(initialPosition, total), pageCount: total };
}

/** The stable locator for the current page. `null` for an empty document. */
export function pdfLocator(state: PdfReaderState): Locator | null {
	if (state.pageCount <= 0) return null;
	return makeLocator(state.pageIndex, 0);
}

export function goToPdfPage(state: PdfReaderState, pageIndex: number): PdfReaderState {
	const next = clampPageIndex(pageIndex, state.pageCount);
	return next === state.pageIndex ? state : { ...state, pageIndex: next };
}

export function nextPdfPage(state: PdfReaderState): PdfReaderState {
	return goToPdfPage(state, state.pageIndex + 1);
}

export function prevPdfPage(state: PdfReaderState): PdfReaderState {
	return goToPdfPage(state, state.pageIndex - 1);
}

export function canGoNextPdf(state: PdfReaderState): boolean {
	return state.pageIndex < state.pageCount - 1;
}

export function canGoPrevPdf(state: PdfReaderState): boolean {
	return state.pageIndex > 0;
}

/** 0..1 fraction read — the page you are ON counts as read, mirroring the
 *  reflow reader's "last page = 100%". Empty documents read 0. */
export function pdfProgress(state: PdfReaderState): number {
	if (state.pageCount <= 0) return 0;
	return (state.pageIndex + 1) / state.pageCount;
}
