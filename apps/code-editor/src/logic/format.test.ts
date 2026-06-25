/**
 * 9.7.8 — Prettier formatter integration. Real prettier-standalone runs
 * (no mocks) so the parser/plugin wiring per language is what's proven.
 */
import { describe, expect, it } from "vitest";
import { LanguageKey } from "../types/code-file";
import { canFormat, formatCode } from "./format";

describe("canFormat", () => {
	it("gates exactly the Prettier-covered web languages", () => {
		for (const lang of [
			LanguageKey.TypeScript,
			LanguageKey.TSX,
			LanguageKey.JavaScript,
			LanguageKey.JSX,
			LanguageKey.JSON,
			LanguageKey.JSONC,
			LanguageKey.CSS,
			LanguageKey.HTML,
			LanguageKey.Markdown,
		]) {
			expect(canFormat(lang), lang).toBe(true);
		}
		for (const lang of [
			LanguageKey.Python,
			LanguageKey.Rust,
			LanguageKey.Go,
			LanguageKey.Shell,
			LanguageKey.PlainText,
			LanguageKey.Unknown,
		]) {
			expect(canFormat(lang), lang).toBe(false);
		}
	});
});

describe("formatCode", () => {
	it("formats TypeScript and maps the cursor through the rewrite", async () => {
		const source = "const   x:number=1;\nconst y = 2;";
		const caret = source.indexOf("y");
		const result = await formatCode(source, LanguageKey.TypeScript, caret);
		expect(result).not.toBeNull();
		expect(result?.formatted).toBe("const x: number = 1;\nconst y = 2;\n");
		expect(result?.formatted.charAt(result.cursorOffset)).toBe("y");
	});

	it("formats JavaScript", async () => {
		const result = await formatCode("function  f( a,b ){return a+b}", LanguageKey.JavaScript, 0);
		expect(result?.formatted).toBe("function f(a, b) {\n  return a + b;\n}\n");
	});

	it("formats JSON", async () => {
		const result = await formatCode('{"a":1,"b":[2,3]}', LanguageKey.JSON, 0);
		expect(result?.formatted).toBe('{ "a": 1, "b": [2, 3] }\n');
	});

	it("formats CSS", async () => {
		const result = await formatCode(".a{color:red;margin:0}", LanguageKey.CSS, 0);
		expect(result?.formatted).toBe(".a {\n  color: red;\n  margin: 0;\n}\n");
	});

	it("formats Markdown", async () => {
		const result = await formatCode("#  Title\n\n*  item", LanguageKey.Markdown, 0);
		expect(result?.formatted).toBe("# Title\n\n- item\n");
	});

	it("formats HTML", async () => {
		const result = await formatCode("<div ><span>x</span ></div>", LanguageKey.HTML, 0);
		expect(result?.formatted).toContain("<div>");
		expect(result?.formatted.endsWith("\n")).toBe(true);
	});

	it("returns null for an unformattable language", async () => {
		expect(await formatCode("x = 1", LanguageKey.Python, 0)).toBeNull();
	});

	it("returns null on a syntax error instead of throwing", async () => {
		expect(await formatCode("const = = =", LanguageKey.TypeScript, 0)).toBeNull();
	});
});
