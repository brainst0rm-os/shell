import { describe, expect, it } from "vitest";
import { TextSurfaceKind, spellcheckForSurface } from "./spellcheck";

describe("spellcheckForSurface", () => {
	it("opts prose surfaces in", () => {
		expect(spellcheckForSurface(TextSurfaceKind.Prose)).toBe(true);
	});

	it("opts code surfaces out", () => {
		expect(spellcheckForSurface(TextSurfaceKind.Code)).toBe(false);
	});
});
