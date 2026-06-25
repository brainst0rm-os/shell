// @vitest-environment jsdom
/**
 * Office renderer — exercises the XLSX and PPTX paths against REAL files
 * (built in-test via SheetJS write + fflate zip), and the DOCX path with
 * mammoth mocked (a real .docx is impractical to synthesize). Confirms the
 * sanitizer is on the DOCX path (no script leaks through).
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";

vi.mock("mammoth", () => ({
	convertToHtml: vi.fn(async () => ({
		value: "<p>Hi <script>steal()</script><b>there</b></p>",
		messages: [],
	})),
}));

const { officeRenderer } = await import("./office-renderer");

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function file(name: string, mime: string): PreviewFileInfo {
	return { name, mime, sizeBytes: 10, modifiedAt: null };
}

async function mount(bytes: Uint8Array, mime: string, name: string) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const source: PreviewSource = { kind: "bytes", bytes, mime };
	const instance = await officeRenderer.mount({ host, source, file: file(name, mime) });
	return { host, instance };
}

describe("officeRenderer", () => {
	it("binds the Office kind", () => {
		expect(officeRenderer.kind).toBe(PreviewKind.Office);
	});

	it("reports the format label per family", () => {
		const meta = (mime: string) =>
			officeRenderer.extractMetadata?.({ kind: "url", url: "x", mime, sizeBytes: 1 });
		expect(meta(DOCX)).toEqual({ Format: "Word document" });
		expect(meta(XLSX_MIME)).toEqual({ Format: "Excel spreadsheet" });
		expect(meta(PPTX)).toEqual({ Format: "PowerPoint presentation" });
	});

	it("renders a real XLSX into a table with sheet tabs", async () => {
		const ws = XLSX.utils.aoa_to_sheet([
			["Name", "Age"],
			["Ada", 36],
		]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "People");
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Other");
		const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

		const { host, instance } = await mount(bytes, XLSX_MIME, "people.xlsx");
		const cells = Array.from(host.querySelectorAll(".preview-office-table td")).map(
			(c) => c.textContent,
		);
		expect(cells).toContain("Name");
		expect(cells).toContain("Ada");
		expect(cells).toContain("36");
		// Two sheets → a tablist with both names.
		const tabs = Array.from(host.querySelectorAll(".preview-office-tab")).map((t) => t.textContent);
		expect(tabs).toEqual(["People", "Other"]);
		instance.dispose();
		expect(host.children.length).toBe(0);
	});

	it("renders a real PPTX into a per-slide text outline", async () => {
		const slide1 =
			"<p:sld><a:p><a:t>Quarterly Review</a:t></a:p><a:p><a:t>Revenue up</a:t></a:p></p:sld>";
		const slide2 = "<p:sld><a:p><a:t>Thanks</a:t></a:p></p:sld>";
		const bytes = zipSync({
			"ppt/slides/slide1.xml": strToU8(slide1),
			"ppt/slides/slide2.xml": strToU8(slide2),
			"ppt/media/image1.png": new Uint8Array([1, 2, 3]),
		});
		const { host } = await mount(bytes, PPTX, "deck.pptx");
		const slides = host.querySelectorAll(".preview-office-slide");
		expect(slides.length).toBe(2);
		expect(host.textContent).toContain("Quarterly Review");
		expect(host.textContent).toContain("Revenue up");
		expect(host.textContent).toContain("Thanks");
	});

	it("sanitizes DOCX HTML — no script content reaches the DOM", async () => {
		const { host } = await mount(new Uint8Array([1]), DOCX, "doc.docx");
		expect(host.querySelector("script")).toBeNull();
		expect(host.textContent).toContain("Hi there");
		expect(host.textContent).not.toContain("steal");
	});

	it("rejects an unsupported pseudo-Office file cleanly", async () => {
		const host = document.createElement("div");
		await expect(
			officeRenderer.mount({
				host,
				source: { kind: "bytes", bytes: new Uint8Array([0]), mime: "text/plain" },
				file: file("x.txt", "text/plain"),
			}),
		).rejects.toThrow();
	});
});
