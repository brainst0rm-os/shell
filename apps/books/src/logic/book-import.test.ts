import { describe, expect, it } from "vitest";
import { BookFormat } from "../types/book";
import {
	FILE_ENTITY_TYPE,
	IMPORT_EXTENSIONS,
	bookRecordFromImport,
	fileRecordFromImport,
	formatFromName,
	titleFromName,
} from "./book-import";

describe("formatFromName", () => {
	it("maps a .pdf to PDF and .epub to EPUB, case-insensitively", () => {
		expect(formatFromName("Dune.pdf")).toBe(BookFormat.Pdf);
		expect(formatFromName("Dune.PDF")).toBe(BookFormat.Pdf);
		expect(formatFromName("Dune.epub")).toBe(BookFormat.Epub);
		expect(formatFromName("Dune.EPUB")).toBe(BookFormat.Epub);
	});

	it("returns null for an unimportable extension", () => {
		expect(formatFromName("notes.txt")).toBeNull();
		expect(formatFromName("cover.png")).toBeNull();
		expect(formatFromName("no-extension")).toBeNull();
	});

	it("covers exactly the advertised extensions", () => {
		for (const ext of IMPORT_EXTENSIONS) {
			expect(formatFromName(`book.${ext}`)).not.toBeNull();
		}
	});
});

describe("titleFromName", () => {
	it("strips a directory prefix and the book extension", () => {
		expect(titleFromName("Dune.pdf")).toBe("Dune");
		expect(titleFromName("a/b/Thinking Fast and Slow.epub")).toBe("Thinking Fast and Slow");
		expect(titleFromName("C:\\books\\Dune.PDF")).toBe("Dune");
	});

	it("keeps dots that are not the trailing book extension", () => {
		expect(titleFromName("Vol.2 - Dune.pdf")).toBe("Vol.2 - Dune");
	});

	it("returns the basename verbatim when no book extension matches", () => {
		expect(titleFromName("a/b/manuscript")).toBe("manuscript");
	});
});

describe("fileRecordFromImport", () => {
	it("builds an attachment URL from the asset id and mirrors the Files shape", () => {
		const record = fileRecordFromImport({
			assetId: "asset-123",
			contentHash: "hash-abc",
			size: 4096,
			mime: "application/pdf",
			name: "Dune.pdf",
		});
		expect(record).toEqual({
			name: "Dune.pdf",
			mime: "application/pdf",
			size: 4096,
			hash: "hash-abc",
			attachment: "brainstorm://asset/asset-123",
			assetId: "asset-123",
			assetMime: "application/pdf",
		});
	});
});

describe("bookRecordFromImport", () => {
	it("links the file, parks reading state empty, and mirrors the id", () => {
		const record = bookRecordFromImport({
			id: "bk-1",
			fileId: "fil-1",
			title: "Dune",
			format: BookFormat.Pdf,
			now: 1000,
		});
		expect(record.id).toBe("bk-1");
		expect(record.fileId).toBe("fil-1");
		expect(record.name).toBe("Dune");
		expect(record.format).toBe(BookFormat.Pdf);
		expect(record.author).toBe("");
		expect(record.spineLength).toBe(0);
		expect(record.reading).toEqual({ position: null, progress: 0, lastReadAt: null });
		expect(record.createdAt).toBe(1000);
		expect(record.updatedAt).toBe(1000);
	});
});

describe("FILE_ENTITY_TYPE", () => {
	it("is the canonical File wire id", () => {
		expect(FILE_ENTITY_TYPE).toBe("brainstorm/File/v1");
	});
});
