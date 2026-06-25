import { describe, expect, it } from "vitest";
import { humaniseBytes, humaniseMime } from "./inspector-format";

describe("inspector-format", () => {
	it("humaniseBytes scales through KB / MB / GB", () => {
		expect(humaniseBytes(512)).toBe("512 B");
		expect(humaniseBytes(2048)).toBe("2.0 KB");
		expect(humaniseBytes(5 * 1024 * 1024)).toBe("5.0 MB");
		expect(humaniseBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
		expect(humaniseBytes(-1)).toBe("—");
	});

	it("humaniseMime collapses common MIMEs to human strings", () => {
		expect(humaniseMime("text/markdown")).toBe("Markdown");
		expect(humaniseMime("text/plain")).toBe("Plain text");
		expect(humaniseMime("image/svg+xml")).toBe("SVG image");
		expect(humaniseMime("image/png")).toBe("PNG image");
		expect(humaniseMime("application/pdf")).toBe("PDF document");
		expect(humaniseMime("video/mp4")).toBe("MP4 video");
	});
});
