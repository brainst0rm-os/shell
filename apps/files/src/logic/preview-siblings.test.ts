import { describe, expect, it } from "vitest";
import {
	type PreviewSiblingRow,
	buildPreviewSiblings,
	isPreviewableMime,
} from "./preview-siblings";

const FILE = "io.brainstorm.files/File/v1";
const FOLDER = "io.brainstorm.files/Folder/v1";

function row(over: Partial<PreviewSiblingRow> & Pick<PreviewSiblingRow, "id">): PreviewSiblingRow {
	return {
		type: FILE,
		name: `${over.id}.png`,
		mime: "image/png",
		sizeBytes: 10,
		modifiedAt: 1,
		url: `brainstorm://app-file/${over.id}`,
		...over,
	};
}

describe("isPreviewableMime", () => {
	it("accepts image / video / audio / text families and pdf", () => {
		for (const m of [
			"image/png",
			"image/jpeg",
			"video/mp4",
			"audio/mpeg",
			"text/plain",
			"text/markdown",
			"application/pdf",
		]) {
			expect(isPreviewableMime(m)).toBe(true);
		}
	});

	it("normalizes case and strips parameters", () => {
		expect(isPreviewableMime("IMAGE/PNG")).toBe(true);
		expect(isPreviewableMime("text/plain; charset=utf-8")).toBe(true);
	});

	it("rejects unknown / empty / nullish mimes", () => {
		expect(isPreviewableMime("application/zip")).toBe(false);
		expect(isPreviewableMime("")).toBe(false);
		expect(isPreviewableMime(null)).toBe(false);
		expect(isPreviewableMime(undefined)).toBe(false);
	});
});

describe("buildPreviewSiblings", () => {
	it("preserves the input (visible) order — never re-sorts", () => {
		const rows = [row({ id: "c" }), row({ id: "a" }), row({ id: "b" })];
		expect(buildPreviewSiblings(rows, FILE).map((s) => s.id)).toEqual(["c", "a", "b"]);
	});

	it("drops folders, non-previewable mimes, and url-less (bytes-only) rows", () => {
		const rows = [
			row({ id: "keep1" }),
			row({ id: "folder", type: FOLDER }),
			row({ id: "archive", mime: "application/zip" }),
			row({ id: "bytesonly", url: null }),
			row({ id: "nomime", mime: null }),
			row({ id: "keep2", mime: "application/pdf", name: "doc.pdf" }),
		];
		expect(buildPreviewSiblings(rows, FILE).map((s) => s.id)).toEqual(["keep1", "keep2"]);
	});

	it("maps the full sibling shape through", () => {
		const [s] = buildPreviewSiblings(
			[row({ id: "x", name: "shot.png", sizeBytes: 2048, modifiedAt: 999 })],
			FILE,
		);
		expect(s).toEqual({
			id: "x",
			name: "shot.png",
			mime: "image/png",
			sizeBytes: 2048,
			modifiedAt: 999,
			url: "brainstorm://app-file/x",
		});
	});

	it("returns an empty list when nothing qualifies", () => {
		expect(buildPreviewSiblings([row({ id: "f", type: FOLDER })], FILE)).toEqual([]);
		expect(buildPreviewSiblings([], FILE)).toEqual([]);
	});
});
