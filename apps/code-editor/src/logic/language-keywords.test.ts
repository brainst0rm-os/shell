/**
 * Per-language keyword completion map (9.7.3). The lists feed the
 * autocomplete core's optional `keywords` seam; these assert the right
 * language gets the right reserved words and that data formats get none.
 */

import { describe, expect, it } from "vitest";
import { LanguageKey } from "../types/code-file";
import { keywordsForLanguage } from "./language-keywords";

describe("keywordsForLanguage", () => {
	it("returns each language's reserved words", () => {
		expect(keywordsForLanguage(LanguageKey.TypeScript)).toContain("interface");
		expect(keywordsForLanguage(LanguageKey.TypeScript)).toContain("const");
		expect(keywordsForLanguage(LanguageKey.Python)).toContain("def");
		expect(keywordsForLanguage(LanguageKey.Python)).toContain("elif");
		expect(keywordsForLanguage(LanguageKey.Rust)).toContain("fn");
		expect(keywordsForLanguage(LanguageKey.Go)).toContain("func");
		expect(keywordsForLanguage(LanguageKey.SQL)).toContain("SELECT");
	});

	it("TypeScript is a superset of JavaScript; JS omits the TS-only words", () => {
		const js = keywordsForLanguage(LanguageKey.JavaScript);
		const ts = keywordsForLanguage(LanguageKey.TypeScript);
		expect(js).toContain("const");
		expect(js).not.toContain("interface");
		for (const kw of js) expect(ts).toContain(kw);
	});

	it("each list is duplicate-free", () => {
		for (const language of [
			LanguageKey.TypeScript,
			LanguageKey.JavaScript,
			LanguageKey.Python,
			LanguageKey.Rust,
			LanguageKey.Go,
			LanguageKey.Java,
			LanguageKey.Shell,
			LanguageKey.SQL,
		]) {
			const list = keywordsForLanguage(language);
			expect(new Set(list).size, `${language} has duplicates`).toBe(list.length);
		}
	});

	it("data / markup / unknown languages have no keywords", () => {
		expect(keywordsForLanguage(LanguageKey.JSON)).toEqual([]);
		expect(keywordsForLanguage(LanguageKey.YAML)).toEqual([]);
		expect(keywordsForLanguage(LanguageKey.Markdown)).toEqual([]);
		expect(keywordsForLanguage(LanguageKey.PlainText)).toEqual([]);
		expect(keywordsForLanguage(LanguageKey.Unknown)).toEqual([]);
	});
});
