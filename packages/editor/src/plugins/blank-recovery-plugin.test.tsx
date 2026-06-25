import { describe, expect, it } from "vitest";
import { isBlankWithContent } from "./blank-recovery-plugin";

describe("isBlankWithContent", () => {
	it("recovers when the Y.Doc has blocks but Lexical rendered none", () => {
		expect(isBlankWithContent(4, 0)).toBe(true);
		expect(isBlankWithContent(1, 0)).toBe(true);
	});

	it("does not recover a genuinely empty doc (normalize/bootstrap own that)", () => {
		expect(isBlankWithContent(0, 0)).toBe(false);
	});

	it("does not recover a healthy doc", () => {
		expect(isBlankWithContent(4, 4)).toBe(false);
		expect(isBlankWithContent(2, 2)).toBe(false);
	});

	it("does not recover a partially-synced doc (only total-blank triggers)", () => {
		// Conservative: a non-zero Lexical count means the binding is alive.
		expect(isBlankWithContent(4, 1)).toBe(false);
	});
});
