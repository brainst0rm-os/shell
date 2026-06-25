// @vitest-environment jsdom
/**
 * Audio renderer — mounts a centred card (name + format + glyph) above
 * a native <audio controls>, owns the blob URL, revokes + clears on
 * dispose.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { audioRenderer } from "./audio-renderer";

const FILE: PreviewFileInfo = {
	name: "track.mp3",
	mime: "audio/mpeg",
	sizeBytes: 2048,
	modifiedAt: Date.now(),
};

function bytes(): PreviewSource {
	return { kind: "bytes", bytes: new Uint8Array([9, 8, 7]), mime: "audio/mpeg" };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("audioRenderer", () => {
	it("mounts a card with name + format chip + a controlled <audio>", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/a");
		const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const host = document.createElement("div");
		document.body.appendChild(host);

		const instance = await audioRenderer.mount({ source: bytes(), file: FILE, host });
		expect(host.querySelector(".preview-audio__name")?.textContent).toBe("track.mp3");
		expect(host.querySelector(".preview-audio__format")?.textContent).toBe("MPEG");
		const audio = host.querySelector("audio");
		expect(audio?.controls).toBe(true);
		expect(audio?.getAttribute("src")).toBe("blob:fake/a");

		instance.dispose();
		expect(revokeSpy).toHaveBeenCalledWith("blob:fake/a");
		expect(host.children.length).toBe(0);
	});

	it("never sets innerHTML for the filename — a hostile name stays inert text", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/a");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const host = document.createElement("div");
		const hostile: PreviewFileInfo = { ...FILE, name: "<img src=x onerror=1>.mp3" };
		const instance = await audioRenderer.mount({ source: bytes(), file: hostile, host });
		expect(host.querySelectorAll("img").length).toBe(0);
		expect(host.querySelector(".preview-audio__name")?.textContent).toContain("<img");
		instance.dispose();
	});
});
