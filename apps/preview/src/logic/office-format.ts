/**
 * Office format keystone — 9.20.9.
 *
 * Which OOXML family a file is (`officeFormatFor`) and its human label.
 * Pure, dependency-free; the heavy mammoth / xlsx / fflate work lives in
 * the renderer behind the registry's dynamic import.
 */

export enum OfficeFormat {
	Docx = "docx",
	Xlsx = "xlsx",
	Pptx = "pptx",
}

const OFFICE_MIME: Readonly<Record<string, OfficeFormat>> = {
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": OfficeFormat.Docx,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": OfficeFormat.Xlsx,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": OfficeFormat.Pptx,
};

const OFFICE_EXT: Readonly<Record<string, OfficeFormat>> = {
	docx: OfficeFormat.Docx,
	xlsx: OfficeFormat.Xlsx,
	pptx: OfficeFormat.Pptx,
};

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot < 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

/** Resolve the OOXML family from MIME, falling back to the filename
 *  extension. `null` when neither names a supported Office format. */
export function officeFormatFor(mime: string, name: string): OfficeFormat | null {
	const normalised = mime.toLowerCase().split(";")[0]?.trim() ?? "";
	const byMime = OFFICE_MIME[normalised];
	if (byMime !== undefined) return byMime;
	return OFFICE_EXT[extensionOf(name)] ?? null;
}

export function officeFormatLabel(format: OfficeFormat): string {
	switch (format) {
		case OfficeFormat.Docx:
			return "Word document";
		case OfficeFormat.Xlsx:
			return "Excel spreadsheet";
		case OfficeFormat.Pptx:
			return "PowerPoint presentation";
	}
}
