// @vitest-environment jsdom
/**
 * Video renderer — mounts a native <video controls> from a bytes
 * source, owns the Blob object URL, and revokes it + clears the host on
 * dispose. PiP affordance only renders where the platform supports it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { videoRenderer } from "./video-renderer";

const FILE: PreviewFileInfo = {
	name: "clip.mp4",
	mime: "video/mp4",
	sizeBytes: 1024,
	modifiedAt: Date.now(),
};

function bytes(): PreviewSource {
	return { kind: "bytes", bytes: new Uint8Array([0, 1, 2, 3]), mime: "video/mp4" };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("videoRenderer", () => {
	it("mounts a controlled <video> and owns the blob URL", async () => {
		const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/v");
		const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const host = document.createElement("div");
		document.body.appendChild(host);

		const instance = await videoRenderer.mount({ source: bytes(), file: FILE, host });
		const video = host.querySelector("video");
		expect(video).not.toBeNull();
		expect(video?.controls).toBe(true);
		expect(video?.getAttribute("src")).toBe("blob:fake/v");
		expect(createSpy).toHaveBeenCalledOnce();

		instance.dispose();
		expect(revokeSpy).toHaveBeenCalledWith("blob:fake/v");
		expect(host.children.length).toBe(0);
	});

	it("hands a url source straight through without creating an object URL", async () => {
		const createSpy = vi.spyOn(URL, "createObjectURL");
		const host = document.createElement("div");
		const source: PreviewSource = {
			kind: "url",
			url: "brainstorm://file/abc",
			mime: "video/mp4",
			sizeBytes: null,
		};
		const instance = await videoRenderer.mount({ source, file: FILE, host });
		expect(host.querySelector("video")?.getAttribute("src")).toBe("brainstorm://file/abc");
		expect(createSpy).not.toHaveBeenCalled();
		instance.dispose();
	});

	it("omits the PiP button when the platform has no Picture-in-Picture", async () => {
		// jsdom leaves document.pictureInPictureEnabled undefined (falsy).
		const host = document.createElement("div");
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/v");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const instance = await videoRenderer.mount({ source: bytes(), file: FILE, host });
		expect(host.querySelector(".preview-media__pip")).toBeNull();
		instance.dispose();
	});

	it("extractMetadata resolves with the format chip even when metadata never loads", async () => {
		vi.useFakeTimers();
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/probe");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const promise = videoRenderer.extractMetadata?.(bytes());
		await vi.advanceTimersByTimeAsync(4000);
		const meta = await promise;
		expect(meta).toMatchObject({ Format: "MP4" });
		vi.useRealTimers();
	});
});
