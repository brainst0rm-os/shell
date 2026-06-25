import { describe, expect, it } from "vitest";
import { IconKind } from "./icon";
import { TAB_ICON_NONE, emojiFaviconUrl, tabFaviconUrl } from "./tab-identity";

describe("tabFaviconUrl", () => {
	it("encodes emoji as an SVG data URL", () => {
		const url = tabFaviconUrl({ kind: IconKind.Emoji, value: "📝" });
		expect(url.startsWith("data:image/svg+xml,")).toBe(true);
		expect(decodeURIComponent(url)).toContain("📝");
		expect(url).toBe(emojiFaviconUrl("📝"));
	});

	it("passes brainstorm image URLs through and rejects other schemes", () => {
		expect(tabFaviconUrl({ kind: IconKind.Image, value: "brainstorm://icon/a.png" })).toBe(
			"brainstorm://icon/a.png",
		);
		expect(tabFaviconUrl({ kind: IconKind.Image, value: "https://evil.example/x.png" })).toBe(
			TAB_ICON_NONE,
		);
	});

	it("degrades pack / null / empty to TAB_ICON_NONE", () => {
		expect(tabFaviconUrl({ kind: IconKind.Pack, value: "phosphor/files" })).toBe(TAB_ICON_NONE);
		expect(tabFaviconUrl(null)).toBe(TAB_ICON_NONE);
		expect(tabFaviconUrl({ kind: IconKind.Emoji, value: "" })).toBe(TAB_ICON_NONE);
	});

	it("escapes XML-significant characters so a malformed value can't inject SVG", () => {
		const url = emojiFaviconUrl('<text onload="x">&');
		const svg = decodeURIComponent(url);
		expect(svg).not.toContain('<text onload="x">');
		expect(svg).toContain("&lt;text");
	});
});
