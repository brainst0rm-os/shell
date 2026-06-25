import { afterEach, describe, expect, it } from "vitest";
import { MediaFileKind, classifyMediaFile, tryUploadFile } from "./media-upload";
import { setEditorHost } from "./plugins/editor-host";

/** Minimal `File`-like — `tryUploadFile` only reads `name` / `type` /
 *  `arrayBuffer()`, so we avoid depending on a DOM `File` constructor. */
function fakeFile(name: string, type: string, bytes = 3): File {
	return {
		name,
		type,
		arrayBuffer: async () => new ArrayBuffer(bytes),
	} as unknown as File;
}

afterEach(() => {
	setEditorHost({});
});

describe("classifyMediaFile", () => {
	it("routes by MIME prefix, falling back to File", () => {
		expect(classifyMediaFile(fakeFile("a.png", "image/png"))).toBe(MediaFileKind.Image);
		expect(classifyMediaFile(fakeFile("a.mp4", "video/mp4"))).toBe(MediaFileKind.Video);
		expect(classifyMediaFile(fakeFile("a.mp3", "audio/mpeg"))).toBe(MediaFileKind.Audio);
		expect(classifyMediaFile(fakeFile("a.zip", "application/zip"))).toBe(MediaFileKind.File);
		expect(classifyMediaFile(fakeFile("a", ""))).toBe(MediaFileKind.File);
	});
});

describe("tryUploadFile host bridge", () => {
	it("returns null when no host uploader is wired", async () => {
		expect(await tryUploadFile(fakeFile("a.png", "image/png"))).toBeNull();
	});

	it("delegates to the wired host uploader and returns its url", async () => {
		const seen: { filename: string; mime: string | undefined }[] = [];
		setEditorHost({
			uploadFile: async (filename, _bytes, mime) => {
				seen.push({ filename, mime });
				return { url: "brainstorm://app-file/abc", hash: "h", ext: "png", size: 3, mime: mime ?? "" };
			},
		});
		const url = await tryUploadFile(fakeFile("a.png", "image/png"));
		expect(url).toBe("brainstorm://app-file/abc");
		expect(seen).toEqual([{ filename: "a.png", mime: "image/png" }]);
	});

	it("returns null (does not throw) when the host uploader rejects", async () => {
		setEditorHost({
			uploadFile: async () => {
				throw new Error("offline");
			},
		});
		expect(await tryUploadFile(fakeFile("a.png", "image/png"))).toBeNull();
	});
});
