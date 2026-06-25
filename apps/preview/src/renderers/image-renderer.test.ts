// @vitest-environment jsdom
/**
 * Image renderer — mount + dispose smoke. URL sources land in `img.src`
 * directly; bytes sources wrap in a Blob + object-URL which `dispose()`
 * must revoke.
 */

import { describe, expect, it, vi } from "vitest";
import type { PreviewFileInfo, PreviewSource } from "../types/preview-module";
import { imageRenderer } from "./image-renderer";

const FILE: PreviewFileInfo = {
	name: "demo.png",
	mime: "image/png",
	sizeBytes: 128,
	modifiedAt: Date.now(),
};

function mount(source: PreviewSource): {
	host: HTMLElement;
	instance: ReturnType<typeof imageRenderer.mount>;
} {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const instance = imageRenderer.mount({ source, file: FILE, host });
	return { host, instance };
}

describe("imageRenderer", () => {
	it("mounts an <img> with src set from a url source", () => {
		const { host, instance } = mount({
			kind: "url",
			url: "data:image/png;base64,iVBOR",
			mime: "image/png",
			sizeBytes: 5,
		});
		const img = host.querySelector("img");
		expect(img).not.toBeNull();
		expect(img?.getAttribute("alt")).toBe("demo.png");
		expect(img?.src).toContain("data:image/png");
		(instance as { dispose: () => void }).dispose();
		expect(host.children.length).toBe(0);
	});

	it("wraps a bytes source in a Blob + object URL and revokes it on dispose", () => {
		const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake/abc");
		const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const { host, instance } = mount({
			kind: "bytes",
			bytes: new Uint8Array([0x89, 0x50]),
			mime: "image/png",
		});
		expect(createSpy).toHaveBeenCalledOnce();
		const img = host.querySelector("img") as HTMLImageElement;
		expect(img.src).toContain("blob:fake/abc");
		(instance as { dispose: () => void }).dispose();
		expect(revokeSpy).toHaveBeenCalledWith("blob:fake/abc");
		createSpy.mockRestore();
		revokeSpy.mockRestore();
	});

	it("extractMetadata reports a humanised Format for image/* MIMEs", async () => {
		// No bytes decodable in jsdom (createImageBitmap absent, fetch of a
		// bogus url rejects) so only the Format row is emitted.
		expect(
			await imageRenderer.extractMetadata?.({
				kind: "url",
				url: "x",
				mime: "image/svg+xml",
				sizeBytes: 0,
			}),
		).toEqual({ Format: "SVG" });
		expect(
			await imageRenderer.extractMetadata?.({
				kind: "url",
				url: "x",
				mime: "image/png",
				sizeBytes: 0,
			}),
		).toEqual({ Format: "PNG" });
	});

	it("extractMetadata folds EXIF pairs in for a JPEG bytes source", async () => {
		// 0xFFD8 with no APP1 → parseExif returns {} → just Format (no
		// createImageBitmap in jsdom so no Dimensions row).
		const meta = await imageRenderer.extractMetadata?.({
			kind: "bytes",
			bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
			mime: "image/jpeg",
		});
		expect(meta).toEqual({ Format: "JPEG" });
	});

	it("mounts the pannable viewport + zoom HUD with zoom, fit, and rotate controls", () => {
		const { host, instance } = mount({
			kind: "url",
			url: "data:image/png;base64,iVBOR",
			mime: "image/png",
			sizeBytes: 5,
		});
		expect(host.querySelector(".preview-image-viewport")).not.toBeNull();
		const hud = host.querySelector(".preview-image-hud");
		expect(hud).not.toBeNull();
		// −, +, Fit, ↺, ↻, ⇄, ⇅
		expect(hud?.querySelectorAll(".preview-image-hud__btn").length).toBe(7);
		expect(host.querySelector('[aria-label="Rotate left"]')).not.toBeNull();
		expect(host.querySelector('[aria-label="Rotate right"]')).not.toBeNull();
		expect(host.querySelector('[aria-label="Flip horizontal"]')).not.toBeNull();
		expect(host.querySelector('[aria-label="Flip vertical"]')).not.toBeNull();
		(instance as { dispose: () => void }).dispose();
		expect(host.children.length).toBe(0);
	});

	it("rotate buttons add a rotate() step to the image transform (9.20.8)", () => {
		const { host, instance } = mount({
			kind: "url",
			url: "data:image/png;base64,iVBOR",
			mime: "image/png",
			sizeBytes: 5,
		});
		const img = host.querySelector("img") as HTMLImageElement;
		// jsdom never fires `load` for a data URL — simulate a decoded image so
		// the renderer leaves the `ready` guard and rotation takes effect.
		Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
		Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
		img.dispatchEvent(new Event("load"));

		const rotateRight = host.querySelector('[aria-label="Rotate right"]') as HTMLButtonElement;
		const rotateLeft = host.querySelector('[aria-label="Rotate left"]') as HTMLButtonElement;

		expect(img.style.transform).toContain("rotate(0deg)");
		rotateRight.click();
		expect(img.style.transform).toContain("rotate(90deg)");
		rotateRight.click();
		expect(img.style.transform).toContain("rotate(180deg)");
		rotateLeft.click();
		expect(img.style.transform).toContain("rotate(90deg)");

		(instance as { dispose: () => void }).dispose();
	});

	it("KBN-A: the HUD is a toolbar (role from the binding) with arrow-key roving", () => {
		const { host, instance } = mount({
			kind: "url",
			url: "data:image/png;base64,iVBOR",
			mime: "image/png",
			sizeBytes: 5,
		});
		const hud = host.querySelector<HTMLElement>(".preview-image-hud");
		if (!hud) throw new Error("no hud");
		// Role flows from the binding (not hand-written on the element).
		expect(hud.getAttribute("role")).toBe("toolbar");
		expect(hud.getAttribute("aria-orientation")).toBe("horizontal");
		const buttons = hud.querySelectorAll<HTMLButtonElement>(".preview-image-hud__btn");
		// Toolbar items are native buttons — the binding omits an item role.
		expect(buttons[0]?.getAttribute("role")).toBeNull();
		// First control is the tab stop; the rest are removed from the tab order.
		expect(buttons[0]?.getAttribute("tabindex")).toBe("0");
		expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");
		// ArrowRight roves the cursor to the next control.
		hud.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(buttons[0]?.getAttribute("tabindex")).toBe("-1");
		expect(buttons[1]?.getAttribute("tabindex")).toBe("0");
		(instance as { dispose: () => void }).dispose();
	});

	it("flip buttons mirror the image transform, toggling independently (9.20.8)", () => {
		const { host, instance } = mount({
			kind: "url",
			url: "data:image/png;base64,iVBOR",
			mime: "image/png",
			sizeBytes: 5,
		});
		const img = host.querySelector("img") as HTMLImageElement;
		Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
		Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
		img.dispatchEvent(new Event("load"));

		const flipH = host.querySelector('[aria-label="Flip horizontal"]') as HTMLButtonElement;
		const flipV = host.querySelector('[aria-label="Flip vertical"]') as HTMLButtonElement;

		expect(img.style.transform).toContain("scale(1, 1)");
		flipH.click();
		expect(img.style.transform).toContain("scale(-1, 1)");
		flipV.click();
		expect(img.style.transform).toContain("scale(-1, -1)");
		flipH.click();
		expect(img.style.transform).toContain("scale(1, -1)");

		(instance as { dispose: () => void }).dispose();
	});
});
