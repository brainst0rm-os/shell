// @vitest-environment jsdom
/**
 * HEIC renderer — routing + failure contract. The real libheif decode
 * needs the browser (wasm + createImageBitmap), exercised in the shell;
 * here `heic-to` is mocked so we verify the decode → image-renderer
 * delegation and the clean failure path.
 */
import { describe, expect, it, vi } from "vitest";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";

vi.mock("heic-to", () => ({ heicTo: vi.fn() }));
const { heicTo } = await import("heic-to");
const { heicRenderer } = await import("./heic-renderer");
const heicToMock = vi.mocked(heicTo);

const FILE: PreviewFileInfo = {
	name: "photo.heic",
	mime: "image/heic",
	sizeBytes: 9,
	modifiedAt: null,
};

describe("heicRenderer", () => {
	it("binds the Heic kind", () => {
		expect(heicRenderer.kind).toBe(PreviewKind.Heic);
	});

	it("labels HEIC vs HEIF in metadata", () => {
		expect(
			heicRenderer.extractMetadata?.({ kind: "url", url: "x", mime: "image/heic", sizeBytes: 1 }),
		).toEqual({
			Format: "HEIC",
		});
		expect(
			heicRenderer.extractMetadata?.({ kind: "url", url: "x", mime: "image/heif", sizeBytes: 1 }),
		).toEqual({
			Format: "HEIF",
		});
	});

	it("decodes to JPEG and mounts an <img> through the image renderer", async () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9]);
		heicToMock.mockResolvedValueOnce(new Blob([jpeg], { type: "image/jpeg" }));
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/heic");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

		const host = document.createElement("div");
		document.body.appendChild(host);
		const source: PreviewSource = {
			kind: "bytes",
			bytes: new Uint8Array([1, 2, 3]),
			mime: "image/heic",
		};
		const instance = await heicRenderer.mount({ host, source, file: FILE });

		expect(heicToMock).toHaveBeenCalledOnce();
		const img = host.querySelector("img");
		expect(img?.src).toContain("blob:fake/heic");
		instance.dispose();
		expect(host.children.length).toBe(0);
		vi.restoreAllMocks();
	});

	it("fails cleanly when the decoder throws", async () => {
		heicToMock.mockRejectedValueOnce(new Error("libheif boom"));
		const host = document.createElement("div");
		const source: PreviewSource = { kind: "bytes", bytes: new Uint8Array([1]), mime: "image/heic" };
		await expect(heicRenderer.mount({ host, source, file: FILE })).rejects.toThrow(/HEIC/i);
	});
});
