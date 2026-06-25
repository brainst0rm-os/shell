import { describe, expect, it } from "vitest";
import { UPLOAD_FALLBACK_MIME, isPreviewableImageMime, servedMimeForName } from "./upload-mime";

describe("servedMimeForName", () => {
	it("maps preview-safe extensions case-insensitively", () => {
		expect(servedMimeForName("photo.png")).toBe("image/png");
		expect(servedMimeForName("PHOTO.JPG")).toBe("image/jpeg");
		expect(servedMimeForName("clip.WebM")).toBe("video/webm");
		expect(servedMimeForName("paper.pdf")).toBe("application/pdf");
		expect(servedMimeForName("notes.md")).toBe("text/plain");
	});

	it("collapses active content to octet-stream — svg/html/xml/js never get a renderable Content-Type", () => {
		for (const name of ["vector.svg", "page.html", "page.htm", "feed.xml", "script.js"]) {
			expect(servedMimeForName(name)).toBe(UPLOAD_FALLBACK_MIME);
		}
	});

	it("falls back on unknown, missing, trailing-dot, and hidden-file names", () => {
		expect(servedMimeForName("archive.xyz")).toBe(UPLOAD_FALLBACK_MIME);
		expect(servedMimeForName("README")).toBe(UPLOAD_FALLBACK_MIME);
		expect(servedMimeForName("weird.")).toBe(UPLOAD_FALLBACK_MIME);
		expect(servedMimeForName(".bashrc")).toBe(UPLOAD_FALLBACK_MIME);
	});
});

describe("isPreviewableImageMime", () => {
	it("accepts image/* and rejects the rest", () => {
		expect(isPreviewableImageMime("image/png")).toBe(true);
		expect(isPreviewableImageMime("application/pdf")).toBe(false);
		expect(isPreviewableImageMime(UPLOAD_FALLBACK_MIME)).toBe(false);
	});
});
