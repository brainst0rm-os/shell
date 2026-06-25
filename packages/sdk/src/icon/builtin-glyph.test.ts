// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createGlyphElement } from "./builtin-glyph";

describe("createGlyphElement", () => {
	it("builds a stroked glyph with the given metrics + paths", () => {
		const el = createGlyphElement(
			{ viewBox: "0 0 16 16", paths: ["M2 2 14 14", "M14 2 2 14"], strokeWidth: 1.25 },
			{ size: 20, className: "x" },
		);
		expect(el.getAttribute("viewBox")).toBe("0 0 16 16");
		expect(el.getAttribute("width")).toBe("20");
		expect(el.getAttribute("fill")).toBe("none");
		expect(el.getAttribute("stroke")).toBe("currentColor");
		expect(el.getAttribute("stroke-width")).toBe("1.25");
		expect(el.getAttribute("stroke-linecap")).toBe("round");
		expect(el.getAttribute("aria-hidden")).toBe("true");
		expect(el.getAttribute("class")).toBe("x");
		expect(el.querySelectorAll("path")).toHaveLength(2);
	});

	it("defaults size to 16 and stroke-width to 1.5", () => {
		const el = createGlyphElement({ viewBox: "0 0 16 16", paths: ["M0 0"] });
		expect(el.getAttribute("width")).toBe("16");
		expect(el.getAttribute("stroke-width")).toBe("1.5");
	});

	it("builds a filled glyph from raw inner markup (no stroke)", () => {
		const el = createGlyphElement({
			viewBox: "0 0 256 256",
			filled: true,
			innerMarkup: '<path d="M10 10h20v20h-20z"/>',
		});
		expect(el.getAttribute("fill")).toBe("currentColor");
		expect(el.getAttribute("stroke")).toBeNull();
		expect(el.querySelectorAll("path")).toHaveLength(1);
	});

	it("adds role + title when a title is given, and marks inline-axis glyphs", () => {
		const el = createGlyphElement(
			{ viewBox: "0 0 16 16", paths: ["M0 0"] },
			{ title: "Next", inlineAxis: true },
		);
		expect(el.getAttribute("aria-hidden")).toBe("false");
		expect(el.getAttribute("role")).toBe("img");
		expect(el.querySelector("title")?.textContent).toBe("Next");
		expect(el.getAttribute("data-icon-direction")).toBe("inline");
	});
});
