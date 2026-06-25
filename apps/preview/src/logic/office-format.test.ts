import { describe, expect, it } from "vitest";
import { OfficeFormat, officeFormatFor, officeFormatLabel } from "./office-format";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("officeFormatFor", () => {
	it("resolves the OOXML families by MIME", () => {
		expect(officeFormatFor(DOCX, "")).toBe(OfficeFormat.Docx);
		expect(officeFormatFor(XLSX_MIME, "")).toBe(OfficeFormat.Xlsx);
		expect(officeFormatFor(PPTX, "")).toBe(OfficeFormat.Pptx);
	});

	it("falls back to the filename extension", () => {
		expect(officeFormatFor("application/octet-stream", "report.docx")).toBe(OfficeFormat.Docx);
		expect(officeFormatFor("", "budget.XLSX")).toBe(OfficeFormat.Xlsx);
		expect(officeFormatFor("", "deck.pptx")).toBe(OfficeFormat.Pptx);
	});

	it("returns null for non-Office input", () => {
		expect(officeFormatFor("application/pdf", "x.pdf")).toBeNull();
		expect(officeFormatFor("", "notes.txt")).toBeNull();
	});

	it("labels every format", () => {
		for (const f of Object.values(OfficeFormat))
			expect(officeFormatLabel(f).length).toBeGreaterThan(0);
	});
});
