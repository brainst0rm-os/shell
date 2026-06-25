import { describe, expect, it } from "vitest";
import { LanguageKey } from "../types/code-file";
import {
	DiagnosticCode,
	DiagnosticSeverity,
	countBySeverity,
	diagnosticRanges,
	lintCode,
} from "./diagnostics";

function codes(content: string, lang = LanguageKey.TypeScript) {
	return lintCode(content, lang).map((d) => d.code);
}

describe("lintCode", () => {
	it("empty buffer → no diagnostics", () => {
		expect(lintCode("", LanguageKey.TypeScript)).toEqual([]);
	});

	it("flags trailing whitespace", () => {
		expect(codes("const x = 1;   \n")).toContain(DiagnosticCode.TrailingWhitespace);
	});

	it("flags mixed tabs + spaces in indentation", () => {
		expect(codes(" \tx").includes(DiagnosticCode.MixedIndent)).toBe(true);
	});

	it("flags an unclosed bracket on its opening line", () => {
		const diags = lintCode("function f() {\n  return 1;\n", LanguageKey.TypeScript);
		const bracket = diags.find((d) => d.code === DiagnosticCode.UnclosedBracket);
		expect(bracket?.severity).toBe(DiagnosticSeverity.Error);
		expect(bracket?.line).toBe(1);
		expect(bracket?.params?.ch).toBe("{");
	});

	it("flags an unmatched closer", () => {
		expect(codes("foo)")).toContain(DiagnosticCode.UnmatchedBracket);
	});

	it("carries the offending bracket as params, not baked prose", () => {
		const d = lintCode("foo)", LanguageKey.TypeScript).find(
			(x) => x.code === DiagnosticCode.UnmatchedBracket,
		);
		expect(d?.params?.ch).toBe(")");
		expect(d).not.toHaveProperty("message");
	});

	it("balanced brackets are clean", () => {
		const out = codes("function f() {\n  return [1, 2, 3];\n}\n");
		expect(out).not.toContain(DiagnosticCode.UnmatchedBracket);
		expect(out).not.toContain(DiagnosticCode.UnclosedBracket);
	});

	it("ignores brackets inside strings + comments", () => {
		const out = codes('const s = "a ( b";\n// ) trailing\n/* { */\n');
		expect(out).not.toContain(DiagnosticCode.UnmatchedBracket);
		expect(out).not.toContain(DiagnosticCode.UnclosedBracket);
	});

	it("skips bracket-balance for prose languages", () => {
		const out = codes("a ( b [ c", LanguageKey.Markdown);
		expect(out).not.toContain(DiagnosticCode.UnmatchedBracket);
		expect(out).not.toContain(DiagnosticCode.UnclosedBracket);
	});

	it("sorts by line + counts by severity", () => {
		const diags = lintCode("x(   \n", LanguageKey.TypeScript);
		expect(diags[0]?.line ?? 0).toBeLessThanOrEqual(diags[diags.length - 1]?.line ?? 0);
		const counts = countBySeverity(diags);
		expect(counts.errors + counts.warnings).toBe(diags.length);
	});

	it("populates column + length for trailing whitespace", () => {
		const d = lintCode("const x = 1;  ", LanguageKey.TypeScript).find(
			(x) => x.code === DiagnosticCode.TrailingWhitespace,
		);
		expect(d?.column).toBe(12);
		expect(d?.length).toBe(2);
	});

	it("populates column 0 + indent length for mixed indent", () => {
		const d = lintCode(" \tx", LanguageKey.TypeScript).find(
			(x) => x.code === DiagnosticCode.MixedIndent,
		);
		expect(d?.column).toBe(0);
		expect(d?.length).toBe(2);
	});

	it("populates the offending bracket column for an unmatched closer", () => {
		const d = lintCode("ab)", LanguageKey.TypeScript).find(
			(x) => x.code === DiagnosticCode.UnmatchedBracket,
		);
		expect(d?.column).toBe(2);
		expect(d?.length).toBe(1);
	});
});

describe("diagnosticRanges", () => {
	it("empty content → no ranges", () => {
		expect(diagnosticRanges("", lintCode("", LanguageKey.TypeScript))).toEqual([]);
	});

	it("maps a column/length diagnostic to absolute offsets", () => {
		const content = "ok\nconst x = 1;  ";
		const ranges = diagnosticRanges(content, lintCode(content, LanguageKey.TypeScript));
		const trailing = ranges.find((r) => r.severity === DiagnosticSeverity.Warning);
		// Line 2 starts at offset 3; trailing ws begins at column 12.
		expect(trailing?.from).toBe(3 + 12);
		expect(trailing?.to).toBe(3 + 14);
		expect(content.slice(trailing?.from, trailing?.to)).toBe("  ");
	});

	it("underlines the offending bracket character span", () => {
		const content = "foo)";
		const ranges = diagnosticRanges(content, lintCode(content, LanguageKey.TypeScript));
		const err = ranges.find((r) => r.severity === DiagnosticSeverity.Error);
		expect(content.slice(err?.from, err?.to)).toBe(")");
	});

	it("falls back to the line content (skipping indent) when no column", () => {
		const content = "\t\tvalue";
		const ranges = diagnosticRanges(content, [
			{
				severity: DiagnosticSeverity.Error,
				code: DiagnosticCode.UnclosedBracket,
				line: 1,
			},
		]);
		expect(content.slice(ranges[0]?.from, ranges[0]?.to)).toBe("value");
	});

	it("drops out-of-range lines and zero-width spans", () => {
		const ranges = diagnosticRanges("abc", [
			{
				severity: DiagnosticSeverity.Warning,
				code: DiagnosticCode.TrailingWhitespace,
				line: 9,
				column: 0,
				length: 1,
			},
			{
				severity: DiagnosticSeverity.Warning,
				code: DiagnosticCode.TrailingWhitespace,
				line: 1,
				column: 1,
				length: 0,
			},
		]);
		expect(ranges).toEqual([]);
	});
});
