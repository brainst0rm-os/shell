import { describe, expect, it } from "vitest";
import { gradientFor, initialsFor } from "./app-icon-palette";

describe("app-icon palette", () => {
	it("gradientFor is deterministic for a given seed", () => {
		expect(gradientFor("io.example.notes")).toEqual(gradientFor("io.example.notes"));
	});

	it("gradientFor returns a different gradient for different seeds (probabilistic)", () => {
		const a = gradientFor("io.example.notes");
		const b = gradientFor("io.example.tasks");
		expect(a).not.toEqual(b);
	});

	it("gradientFor returns a fallback when given an empty seed", () => {
		const g = gradientFor("");
		expect(g.from).toMatch(/^#/);
		expect(g.to).toMatch(/^#/);
		expect(g.ink).toMatch(/^#/);
	});
});

describe("app-icon initials", () => {
	it("takes the first letter of the first two words", () => {
		expect(initialsFor("Text Editor")).toBe("TE");
	});

	it("uppercases", () => {
		expect(initialsFor("notes app")).toBe("NA");
	});

	it("collapses dot/dash/underscore into word boundaries", () => {
		expect(initialsFor("io.example.foo")).toBe("IE");
		expect(initialsFor("foo-bar-baz")).toBe("FB");
		expect(initialsFor("snake_case_name")).toBe("SC");
	});

	it("returns the first two letters when there's a single word", () => {
		expect(initialsFor("Brainstorm")).toBe("BR");
	});

	it("falls back to a bullet for empty input", () => {
		expect(initialsFor("")).toBe("•");
		expect(initialsFor("   ")).toBe("•");
	});

	it("handles single-character names", () => {
		expect(initialsFor("X")).toBe("X");
	});
});
