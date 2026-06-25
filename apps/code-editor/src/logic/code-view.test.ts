import { describe, expect, it } from "vitest";
import { LanguageKey } from "../types/code-file";
import { fileName, gutterWidthCh, languageLabel, toCodeLines } from "./code-view";

describe("toCodeLines", () => {
	it("returns one empty line for an empty buffer", () => {
		expect(toCodeLines("")).toEqual([{ number: 1, text: "" }]);
	});

	it("splits on newlines with 1-based numbering", () => {
		expect(toCodeLines("a\nbb\nccc")).toEqual([
			{ number: 1, text: "a" },
			{ number: 2, text: "bb" },
			{ number: 3, text: "ccc" },
		]);
	});

	it("keeps a trailing-newline blank line so the caret has a home", () => {
		const lines = toCodeLines("a\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).toEqual({ number: 2, text: "" });
	});
});

describe("gutterWidthCh", () => {
	it("floors at 2ch plus a unit of padding for short files", () => {
		expect(gutterWidthCh(1)).toBe(3);
		expect(gutterWidthCh(9)).toBe(3);
	});

	it("grows with the digit count of the largest line number", () => {
		expect(gutterWidthCh(10)).toBe(3);
		expect(gutterWidthCh(100)).toBe(4);
		expect(gutterWidthCh(12345)).toBe(6);
	});

	it("treats a zero/negative line count as one line", () => {
		expect(gutterWidthCh(0)).toBe(3);
		expect(gutterWidthCh(-5)).toBe(3);
	});
});

describe("languageLabel", () => {
	it("maps every known key and collapses Unknown to Plain Text", () => {
		expect(languageLabel(LanguageKey.TypeScript)).toBe("TypeScript");
		expect(languageLabel(LanguageKey.Shell)).toBe("Shell");
		expect(languageLabel(LanguageKey.Unknown)).toBe("Plain Text");
		expect(languageLabel(LanguageKey.PlainText)).toBe("Plain Text");
	});

	it("has a label for every enum member", () => {
		for (const key of Object.values(LanguageKey)) {
			expect(typeof languageLabel(key)).toBe("string");
			expect(languageLabel(key).length).toBeGreaterThan(0);
		}
	});
});

describe("fileName", () => {
	it("returns the last path segment", () => {
		expect(fileName("snippets/runtime.ts")).toBe("runtime.ts");
		expect(fileName("a/b/c/deep.py")).toBe("deep.py");
	});

	it("returns the whole string when there is no separator", () => {
		expect(fileName("README")).toBe("README");
	});

	it("normalises backslashes and falls back on a trailing slash", () => {
		expect(fileName("a\\b\\file.go")).toBe("file.go");
		expect(fileName("dir/")).toBe("dir/");
	});
});
