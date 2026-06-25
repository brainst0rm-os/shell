// @vitest-environment jsdom
/**
 * RAW renderer — extracts the embedded JPEG and delegates to the image
 * renderer. Covers the kind binding, parse-free-ish metadata, the
 * no-preview failure, and the happy path mounting an <img> from the
 * extracted bytes (object-URL mocked, as in the image-renderer test).
 */
import { describe, expect, it, vi } from "vitest";
import { PreviewKind } from "../types/preview-kind";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { rawRenderer } from "./raw-renderer";

const FILE: PreviewFileInfo = {
	name: "shot.cr2",
	mime: "image/x-canon-cr2",
	sizeBytes: 9,
	modifiedAt: null,
};

/** A tiny non-TIFF blob with a JPEG inside — the scan fallback extracts it. */
function rawWithJpeg(): Uint8Array {
	const jpeg = new Uint8Array(40).fill(0x55);
	jpeg[0] = 0xff;
	jpeg[1] = 0xd8;
	jpeg[38] = 0xff;
	jpeg[39] = 0xd9;
	const wrapped = new Uint8Array(jpeg.length + 8);
	wrapped.set(jpeg, 8);
	return wrapped;
}

describe("rawRenderer", () => {
	it("binds the Raw kind", () => {
		expect(rawRenderer.kind).toBe(PreviewKind.Raw);
	});

	it("always reports a Format and surfaces no Camera for a preview-less buffer", async () => {
		const meta = await rawRenderer.extractMetadata?.({
			kind: "bytes",
			bytes: new Uint8Array([1, 2, 3, 4]),
			mime: FILE.mime,
		});
		expect(meta).toEqual({ Format: "RAW" });
	});

	it("rejects with a clean message when there's no embedded preview", async () => {
		const host = document.createElement("div");
		const source: PreviewSource = {
			kind: "bytes",
			bytes: new Uint8Array(32).fill(0xab),
			mime: FILE.mime,
		};
		await expect(rawRenderer.mount({ host, source, file: FILE })).rejects.toThrow(/RAW/i);
	});

	it("extracts the embedded JPEG and mounts an <img> through the image renderer", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/raw");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const host = document.createElement("div");
		document.body.appendChild(host);
		const source: PreviewSource = { kind: "bytes", bytes: rawWithJpeg(), mime: FILE.mime };
		const instance = await rawRenderer.mount({ host, source, file: FILE });
		const img = host.querySelector("img") as HTMLImageElement | null;
		expect(img).not.toBeNull();
		expect(img?.src).toContain("blob:fake/raw");
		instance.dispose();
		expect(host.children.length).toBe(0);
		vi.restoreAllMocks();
	});
});
