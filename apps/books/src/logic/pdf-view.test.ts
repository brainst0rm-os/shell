import { describe, expect, it } from "vitest";
import {
	DEFAULT_PDF_VIEW,
	PdfTint,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_STEP,
	formatZoom,
	stepZoom,
	withTint,
	zoomFactor,
} from "./pdf-view";

describe("pdf-view zoom", () => {
	it("steps up and down by ZOOM_STEP", () => {
		expect(stepZoom(DEFAULT_PDF_VIEW, 1).zoom).toBe(100 + ZOOM_STEP);
		expect(stepZoom(DEFAULT_PDF_VIEW, -1).zoom).toBe(100 - ZOOM_STEP);
	});

	it("clamps to the supported range and returns the same object at the edge", () => {
		const min = { zoom: ZOOM_MIN, tint: PdfTint.Light };
		const max = { zoom: ZOOM_MAX, tint: PdfTint.Light };
		expect(stepZoom(min, -1)).toBe(min);
		expect(stepZoom(max, 1)).toBe(max);
		expect(stepZoom(min, -1).zoom).toBe(ZOOM_MIN);
		expect(stepZoom(max, 1).zoom).toBe(ZOOM_MAX);
	});

	it("zoomFactor is the percentage as a multiplier", () => {
		expect(zoomFactor(DEFAULT_PDF_VIEW)).toBe(1);
		expect(zoomFactor({ zoom: 150, tint: PdfTint.Light })).toBeCloseTo(1.5);
	});

	it("formatZoom renders a clamped percentage label", () => {
		expect(formatZoom(120)).toBe("120%");
		expect(formatZoom(9999)).toBe(`${ZOOM_MAX}%`);
		expect(formatZoom(Number.NaN)).toBe("100%");
	});
});

describe("pdf-view tint", () => {
	it("swaps the tint and keeps zoom", () => {
		const next = withTint({ zoom: 130, tint: PdfTint.Light }, PdfTint.Dark);
		expect(next.tint).toBe(PdfTint.Dark);
		expect(next.zoom).toBe(130);
	});

	it("returns the same object when the tint is unchanged", () => {
		const settings = { zoom: 100, tint: PdfTint.Sepia };
		expect(withTint(settings, PdfTint.Sepia)).toBe(settings);
	});
});
