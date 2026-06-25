import { describe, expect, it } from "vitest";
import { FALLBACK_WALLPAPER, wallpaperBackground, wallpaperThumbUrl } from "./wallpaper";

describe("wallpaperBackground", () => {
	it("solid with a token name expands to var()", () => {
		expect(wallpaperBackground({ kind: "solid", value: "--color-background-primary" })).toBe(
			"var(--color-background-primary)",
		);
	});

	it("solid with a CSS literal passes through", () => {
		expect(wallpaperBackground({ kind: "solid", value: "#0b1220" })).toBe("#0b1220");
		expect(wallpaperBackground({ kind: "solid", value: "rgb(11, 18, 32)" })).toBe("rgb(11, 18, 32)");
	});

	it("solid trims surrounding whitespace", () => {
		expect(wallpaperBackground({ kind: "solid", value: "  #fff  " })).toBe("#fff");
	});

	it("gradient passes the value through verbatim", () => {
		const grad = "linear-gradient(180deg, #111 0%, #333 100%)";
		expect(wallpaperBackground({ kind: "gradient", value: grad })).toBe(grad);
	});

	it("image with a full URL is used verbatim (uploaded wallpapers)", () => {
		expect(wallpaperBackground({ kind: "image", value: "https://example.com/x.jpg" })).toBe(
			'center / cover no-repeat url("https://example.com/x.jpg")',
		);
		expect(wallpaperBackground({ kind: "image", value: "brainstorm://wallpaper/deadbeef.png" })).toBe(
			'center / cover no-repeat url("brainstorm://wallpaper/deadbeef.png")',
		);
	});

	it("image with a bare filename routes through the vault wallpaper protocol (F-007)", () => {
		// The seeded default historically stored a bare filename; without this it
		// resolved to the renderer root and 404'd.
		expect(wallpaperBackground({ kind: "image", value: "stormy-sea.png" })).toBe(
			'center / cover no-repeat url("brainstorm://wallpaper/stormy-sea.png")',
		);
	});

	it("image with a bare filename encodes special characters", () => {
		expect(wallpaperBackground({ kind: "image", value: 'a"b.png' })).toBe(
			'center / cover no-repeat url("brainstorm://wallpaper/a%22b.png")',
		);
	});
});

describe("wallpaperThumbUrl", () => {
	it("derives the thumbnail URL for a vault-stored image", () => {
		expect(wallpaperThumbUrl({ kind: "image", value: "brainstorm://wallpaper/deadbeef.png" })).toBe(
			"brainstorm://wallpaper/deadbeef.png.thumb.jpg",
		);
	});

	it("preserves encoding of names with special characters", () => {
		const name = "a b+c.png";
		const thumb = wallpaperThumbUrl({
			kind: "image",
			value: `brainstorm://wallpaper/${encodeURIComponent(name)}`,
		});
		expect(thumb).toBe(`brainstorm://wallpaper/${encodeURIComponent(`${name}.thumb.jpg`)}`);
		expect(decodeURIComponent(thumb?.replace("brainstorm://wallpaper/", "") ?? "")).toBe(
			"a b+c.png.thumb.jpg",
		);
	});

	it("returns null for non-image kinds", () => {
		expect(wallpaperThumbUrl({ kind: "gradient", value: "linear-gradient(#111,#222)" })).toBeNull();
		expect(wallpaperThumbUrl({ kind: "solid", value: "#000" })).toBeNull();
	});

	it("returns null for images served outside the vault store", () => {
		expect(wallpaperThumbUrl({ kind: "image", value: "https://cdn.example/x.png" })).toBeNull();
	});

	it("does not double-suffix an already-thumbnail URL", () => {
		expect(
			wallpaperThumbUrl({ kind: "image", value: "brainstorm://wallpaper/x.png.thumb.jpg" }),
		).toBeNull();
	});
});

describe("FALLBACK_WALLPAPER", () => {
	it("is a gradient so it paints instantly with no decode", () => {
		expect(FALLBACK_WALLPAPER.kind).toBe("gradient");
		expect(FALLBACK_WALLPAPER.value.length).toBeGreaterThan(0);
	});
});
