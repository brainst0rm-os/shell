import { describe, expect, it } from "vitest";
import { makeLocator } from "../types/locator";
import {
	canGoNextPdf,
	canGoPrevPdf,
	createPdfReaderState,
	goToPdfPage,
	nextPdfPage,
	pageIndexFromLocator,
	pdfLocator,
	pdfProgress,
	prevPdfPage,
} from "./pdf-reader-state";

describe("createPdfReaderState", () => {
	it("starts at the first page with no parked position", () => {
		expect(createPdfReaderState(12)).toEqual({ pageIndex: 0, pageCount: 12 });
	});

	it("restores a parked locator to its page", () => {
		expect(createPdfReaderState(12, makeLocator(4, 0)).pageIndex).toBe(4);
	});

	it("clamps a locator past the end (book shrunk by re-import)", () => {
		expect(createPdfReaderState(5, makeLocator(40, 0)).pageIndex).toBe(4);
	});

	it("normalizes a degenerate page count to empty", () => {
		expect(createPdfReaderState(-3)).toEqual({ pageIndex: 0, pageCount: 0 });
	});
});

describe("navigation", () => {
	const state = createPdfReaderState(3);

	it("advances and retreats within bounds", () => {
		const at1 = nextPdfPage(state);
		expect(at1.pageIndex).toBe(1);
		expect(prevPdfPage(at1).pageIndex).toBe(0);
	});

	it("no-ops keep a stable identity at the edges", () => {
		expect(prevPdfPage(state)).toBe(state);
		const last = goToPdfPage(state, 2);
		expect(nextPdfPage(last)).toBe(last);
	});

	it("goToPdfPage clamps into range", () => {
		expect(goToPdfPage(state, 99).pageIndex).toBe(2);
		expect(goToPdfPage(state, -5).pageIndex).toBe(0);
	});

	it("canGoPrev/Next reflect the edges", () => {
		expect(canGoPrevPdf(state)).toBe(false);
		expect(canGoNextPdf(state)).toBe(true);
		const last = goToPdfPage(state, 2);
		expect(canGoPrevPdf(last)).toBe(true);
		expect(canGoNextPdf(last)).toBe(false);
	});
});

describe("locator mapping", () => {
	it("the current page maps to a collapsed spine locator", () => {
		expect(pdfLocator(goToPdfPage(createPdfReaderState(8), 5))).toEqual(makeLocator(5, 0));
	});

	it("an empty document has no locator", () => {
		expect(pdfLocator(createPdfReaderState(0))).toBeNull();
	});

	it("pageIndexFromLocator handles null + clamping", () => {
		expect(pageIndexFromLocator(null, 10)).toBe(0);
		expect(pageIndexFromLocator(makeLocator(3, 0), 10)).toBe(3);
		expect(pageIndexFromLocator(makeLocator(99, 0), 10)).toBe(9);
		expect(pageIndexFromLocator(makeLocator(2, 0), 0)).toBe(0);
	});
});

describe("pdfProgress", () => {
	it("counts the page you are on as read", () => {
		expect(pdfProgress(createPdfReaderState(4))).toBe(0.25);
		expect(pdfProgress(goToPdfPage(createPdfReaderState(4), 3))).toBe(1);
	});

	it("reads 0 for an empty document", () => {
		expect(pdfProgress(createPdfReaderState(0))).toBe(0);
	});
});
