import { describe, expect, it } from "vitest";
import { emojiFilename, emojiUrl } from "./emoji-url";

describe("emojiFilename", () => {
	it("hyphen-joins the hex codepoints of a single-scalar emoji", () => {
		expect(emojiFilename("🏙️")).toBe("1f3d9-fe0f.webp");
	});

	it("expands a ZWJ sequence into every codepoint", () => {
		// Scientist = person + ZWJ + microscope.
		expect(emojiFilename("🧑‍🔬")).toBe("1f9d1-200d-1f52c.webp");
	});
});

describe("emojiUrl", () => {
	it("points at the shell's bundled emoji scheme", () => {
		expect(emojiUrl("🏙️")).toBe("brainstorm://emoji/1f3d9-fe0f.webp");
	});
});
