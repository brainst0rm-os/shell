import { describe, expect, it } from "vitest";
import { type FileEntityRow, filterPreviewFiles, previewFilesFromEntities } from "./vault-files";

function fileRow(
	id: string,
	name: string,
	updatedAt: number,
	props: Record<string, unknown> = {},
): FileEntityRow {
	return {
		id,
		updatedAt,
		properties: { name, assetId: `asset-${id}`, assetMime: "image/png", ...props },
	};
}

describe("previewFilesFromEntities", () => {
	it("maps File rows to renderable files, newest first", () => {
		const rows = [
			fileRow("a", "older.png", 100),
			fileRow("b", "newest.png", 300),
			fileRow("c", "middle.png", 200),
		];
		const files = previewFilesFromEntities(rows);
		expect(files.map((f) => f.id)).toEqual(["b", "c", "a"]);
		expect(files[0]?.info.name).toBe("newest.png");
		expect(files[0]?.source).toEqual({
			kind: "url",
			url: "brainstorm://asset/asset-b",
			mime: "image/png",
			sizeBytes: null,
		});
	});

	it("drops rows Preview can't render (no MIME / no URL)", () => {
		const rows: FileEntityRow[] = [
			fileRow("ok", "image.png", 100),
			{ id: "no-url", updatedAt: 200, properties: { name: "ghost.bin" } },
			{ id: "no-props", updatedAt: 300, properties: null },
		];
		const files = previewFilesFromEntities(rows);
		expect(files.map((f) => f.id)).toEqual(["ok"]);
	});

	it("falls back to the file's own modifiedAt then 0 when the envelope lacks updatedAt", () => {
		const rows: FileEntityRow[] = [
			{
				id: "withMod",
				properties: { name: "a.png", assetId: "x", assetMime: "image/png", updatedAt: 500 },
			},
			fileRow("withEnvelope", "b.png", 50),
		];
		// withMod sorts first (500 from properties) over withEnvelope (50).
		expect(previewFilesFromEntities(rows).map((f) => f.id)).toEqual(["withMod", "withEnvelope"]);
	});
});

describe("filterPreviewFiles", () => {
	const files = previewFilesFromEntities([
		fileRow("a", "Vacation Photo.png", 300),
		fileRow("b", "invoice.pdf", 200, { assetMime: "application/pdf" }),
		fileRow("c", "screenshot.png", 100),
	]);

	it("returns the same identity for a blank query", () => {
		expect(filterPreviewFiles(files, "   ")).toBe(files);
	});

	it("matches case-insensitively on the filename, preserving order", () => {
		// Upper-case query against the two .png files (invoice.pdf is excluded).
		const out = filterPreviewFiles(files, "PNG");
		expect(out.map((f) => f.id)).toEqual(["a", "c"]);
	});

	it("returns empty when nothing matches", () => {
		expect(filterPreviewFiles(files, "zzz")).toEqual([]);
	});
});
