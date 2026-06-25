import { describe, expect, it } from "vitest";
import { EmbedKind, classifyUrl, faviconUrl, isLoneUrl, parseHttpUrl } from "./embed-providers";

describe("parseHttpUrl", () => {
	it("accepts http(s) and infers a missing scheme", () => {
		expect(parseHttpUrl("https://example.com")?.hostname).toBe("example.com");
		expect(parseHttpUrl("example.com/x")?.protocol).toBe("https:");
	});

	it("rejects non-http schemes, junk, and schemeless single tokens", () => {
		expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
		expect(parseHttpUrl("ftp://example.com")).toBeNull();
		expect(parseHttpUrl("not a url")).toBeNull();
		expect(parseHttpUrl("localhost")).toBeNull();
		expect(parseHttpUrl("")).toBeNull();
	});
});

describe("isLoneUrl", () => {
	it("is true only for a single bare URL", () => {
		expect(isLoneUrl("https://a.com")).toBe(true);
		expect(isLoneUrl("  a.com/path  ")).toBe(true);
		expect(isLoneUrl("see https://a.com now")).toBe(false);
		expect(isLoneUrl("hello")).toBe(false);
	});
});

describe("classifyUrl", () => {
	it("maps YouTube watch / short / youtu.be to a nocookie embed", () => {
		for (const u of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://www.youtube.com/embed/dQw4w9WgXcQ",
			"https://youtube.com/shorts/dQw4w9WgXcQ",
		]) {
			const c = classifyUrl(u);
			expect(c?.kind).toBe(EmbedKind.YouTube);
			expect(c?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
		}
	});

	it("maps Vimeo / Loom / Figma / CodeSandbox", () => {
		expect(classifyUrl("https://vimeo.com/123456789")?.kind).toBe(EmbedKind.Vimeo);
		expect(classifyUrl("https://www.loom.com/share/abc123")?.kind).toBe(EmbedKind.Loom);
		expect(classifyUrl("https://www.figma.com/file/abc/Design")?.kind).toBe(EmbedKind.Figma);
		expect(classifyUrl("https://codesandbox.io/s/cool-sandbox")?.kind).toBe(EmbedKind.CodeSandbox);
	});

	it("falls back to a bookmark for everything else", () => {
		const c = classifyUrl("https://example.com/article");
		expect(c?.kind).toBe(EmbedKind.Bookmark);
		expect(c?.embedUrl).toBeNull();
		expect(c?.host).toBe("example.com");
	});

	it("strips www from the displayed host", () => {
		expect(classifyUrl("https://www.example.com")?.host).toBe("example.com");
	});

	it("returns null for an unparseable input", () => {
		expect(classifyUrl("nonsense")).toBeNull();
	});
});

describe("faviconUrl", () => {
	it("is the origin's conventional favicon path", () => {
		expect(faviconUrl("https://example.com/deep/page")).toBe("https://example.com/favicon.ico");
		expect(faviconUrl("garbage")).toBeNull();
	});
});
