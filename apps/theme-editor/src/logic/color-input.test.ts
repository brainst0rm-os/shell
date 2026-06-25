import { describe, expect, it } from "vitest";
import { toColorInputValue } from "./color-input";

describe("toColorInputValue", () => {
	it("passes a 6-digit hex through, lowercased", () => {
		expect(toColorInputValue("#AABBCC")).toBe("#aabbcc");
		expect(toColorInputValue("  #0a0a0a ")).toBe("#0a0a0a");
	});

	it("expands 3-digit shorthand", () => {
		expect(toColorInputValue("#abc")).toBe("#aabbcc");
	});

	it("falls back to black for anything the picker can't represent", () => {
		expect(toColorInputValue("rgba(0,0,0,0.5)")).toBe("#000000");
		expect(toColorInputValue("red")).toBe("#000000");
		expect(toColorInputValue("var(--x)")).toBe("#000000");
		expect(toColorInputValue("")).toBe("#000000");
	});
});
