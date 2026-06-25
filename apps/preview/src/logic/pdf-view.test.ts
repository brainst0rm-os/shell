import { describe, expect, it } from "vitest";
import {
	PDF_MAX_ZOOM,
	PDF_MIN_ZOOM,
	type PdfNavState,
	clampPage,
	clampZoom,
	fitScale,
	goToPage,
	isFirstPage,
	isLastPage,
	nextPage,
	pageLabel,
	prevPage,
} from "./pdf-view";

const state = (page: number, total: number): PdfNavState => ({ page, total });

describe("clampPage", () => {
	it("clamps into [1, total]", () => {
		expect(clampPage(0, 10)).toBe(1);
		expect(clampPage(5, 10)).toBe(5);
		expect(clampPage(99, 10)).toBe(10);
	});
	it("floors fractional pages and tolerates a zero/negative total", () => {
		expect(clampPage(3.7, 10)).toBe(3);
		expect(clampPage(5, 0)).toBe(1);
		expect(clampPage(Number.NaN, 10)).toBe(1);
	});
});

describe("nextPage / prevPage / goToPage", () => {
	it("steps within bounds and clamps at the edges", () => {
		expect(nextPage(state(1, 3)).page).toBe(2);
		expect(nextPage(state(3, 3)).page).toBe(3);
		expect(prevPage(state(2, 3)).page).toBe(1);
		expect(prevPage(state(1, 3)).page).toBe(1);
		expect(goToPage(state(1, 9), 7).page).toBe(7);
	});
	it("returns the same object reference on a no-op step (stable identity)", () => {
		const s = state(3, 3);
		expect(nextPage(s)).toBe(s);
		const f = state(1, 3);
		expect(prevPage(f)).toBe(f);
	});
});

describe("edge predicates + label", () => {
	it("flags first/last page", () => {
		expect(isFirstPage(state(1, 5))).toBe(true);
		expect(isFirstPage(state(2, 5))).toBe(false);
		expect(isLastPage(state(5, 5))).toBe(true);
		expect(isLastPage(state(4, 5))).toBe(false);
	});
	it("renders a 'n / total' label", () => {
		expect(pageLabel(state(3, 12))).toBe("3 / 12");
		expect(pageLabel(state(1, 0))).toBe("1 / 1");
	});
});

describe("clampZoom", () => {
	it("bounds zoom to [MIN, MAX]", () => {
		expect(clampZoom(0.01)).toBe(PDF_MIN_ZOOM);
		expect(clampZoom(100)).toBe(PDF_MAX_ZOOM);
		expect(clampZoom(2)).toBe(2);
		expect(clampZoom(Number.NaN)).toBe(1);
	});
});

describe("fitScale", () => {
	it("fits the page inside the viewport without upscaling", () => {
		// A 1000×1000 page in a 500×500 viewport → 0.5.
		expect(fitScale(1000, 1000, 500, 500)).toBe(0.5);
		// A small 100×100 page never upscales past 1×.
		expect(fitScale(100, 100, 500, 500)).toBe(1);
	});
	it("picks the limiting axis", () => {
		// Tall page, wide viewport → height-limited.
		expect(fitScale(400, 800, 800, 400)).toBe(0.5);
	});
	it("falls back to 1 for degenerate sizes", () => {
		expect(fitScale(0, 100, 500, 500)).toBe(1);
		expect(fitScale(100, 100, 0, 500)).toBe(1);
	});
});
