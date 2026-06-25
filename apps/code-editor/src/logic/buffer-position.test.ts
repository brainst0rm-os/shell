import { describe, expect, it } from "vitest";
import { countLines, lineColumnToOffset, offsetToLineColumn } from "./buffer-position";

describe("offsetToLineColumn", () => {
	it("returns 1,1 at the start of the file", () => {
		expect(offsetToLineColumn("hello", 0)).toEqual({ line: 1, column: 1 });
	});

	it("counts column on the first line", () => {
		expect(offsetToLineColumn("hello", 3)).toEqual({ line: 1, column: 4 });
	});

	it("walks past newlines into the next line", () => {
		expect(offsetToLineColumn("abc\ndef", 5)).toEqual({ line: 2, column: 2 });
	});

	it("treats a newline as ending the line — offset on the `\\n` itself", () => {
		const r = offsetToLineColumn("abc\ndef", 3);
		expect(r.line).toBe(1);
	});

	it("clamps negative offsets to start", () => {
		expect(offsetToLineColumn("hello", -7)).toEqual({ line: 1, column: 1 });
	});

	it("clamps overflowing offsets to end of last line", () => {
		expect(offsetToLineColumn("abc\ndef", 999)).toEqual({ line: 2, column: 4 });
	});
});

describe("lineColumnToOffset", () => {
	it("returns 0 for line 1 column 1", () => {
		expect(lineColumnToOffset("hello", { line: 1, column: 1 })).toBe(0);
	});

	it("returns the right offset for mid-line column", () => {
		expect(lineColumnToOffset("hello", { line: 1, column: 4 })).toBe(3);
	});

	it("walks to the next line correctly", () => {
		expect(lineColumnToOffset("abc\ndef", { line: 2, column: 2 })).toBe(5);
	});

	it("clamps a column past end of line to end of line", () => {
		expect(lineColumnToOffset("abc\ndef", { line: 1, column: 99 })).toBe(3);
	});

	it("clamps a line past EOF to end of file", () => {
		expect(lineColumnToOffset("abc\ndef", { line: 99, column: 1 })).toBe(7);
	});

	it("treats invalid line numbers as start of file", () => {
		expect(lineColumnToOffset("hello", { line: 0, column: 1 })).toBe(0);
		expect(lineColumnToOffset("hello", { line: -3, column: 1 })).toBe(0);
		expect(lineColumnToOffset("hello", { line: Number.NaN, column: 1 })).toBe(0);
	});

	it("round-trips through offsetToLineColumn for arbitrary offsets", () => {
		const content = "line one\nline two\nline three\n";
		for (let i = 0; i <= content.length; i++) {
			const lc = offsetToLineColumn(content, i);
			const o = lineColumnToOffset(content, lc);
			// Round-trip is exact except on newline characters themselves
			// (the line-column for offset of `\n` rounds to the end of the
			// preceding line).
			if (content.charCodeAt(i) !== 10) {
				expect(o).toBe(i);
			}
		}
	});
});

describe("countLines", () => {
	it("returns 1 for an empty buffer", () => {
		expect(countLines("")).toBe(1);
	});

	it("returns 1 for a single line without trailing newline", () => {
		expect(countLines("hello")).toBe(1);
	});

	it("returns 1 for a single line with trailing newline", () => {
		expect(countLines("hello\n")).toBe(1);
	});

	it("returns 2 for two lines with no trailing newline", () => {
		expect(countLines("a\nb")).toBe(2);
	});

	it("returns 2 for two lines with trailing newline", () => {
		expect(countLines("a\nb\n")).toBe(2);
	});

	it("returns 3 for three lines", () => {
		expect(countLines("a\nb\nc")).toBe(3);
	});
});
