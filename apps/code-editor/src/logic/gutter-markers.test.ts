import { describe, expect, it } from "vitest";
import { gutterLines } from "./gutter-markers";
import { LineChange } from "./line-diff";

describe("gutterLines", () => {
	it("numbers every current line 1-based", () => {
		const lines = gutterLines("", "a\nb\nc");
		expect(lines.map((l) => l.number)).toEqual([1, 2, 3]);
	});

	it("an empty buffer is one unchanged line", () => {
		expect(gutterLines("", "")).toEqual([{ number: 1, change: LineChange.Unchanged }]);
	});

	it("identical buffer + baseline → all unchanged", () => {
		const lines = gutterLines("a\nb\nc", "a\nb\nc");
		expect(lines.every((l) => l.change === LineChange.Unchanged)).toBe(true);
	});

	it("an appended line is Added", () => {
		const lines = gutterLines("a\nb", "a\nb\nc");
		expect(lines[2]?.change).toBe(LineChange.Added);
		expect(lines[0]?.change).toBe(LineChange.Unchanged);
	});

	it("a changed line is Modified", () => {
		const lines = gutterLines("a\nb\nc", "a\nB\nc");
		expect(lines[1]?.change).toBe(LineChange.Modified);
	});

	it("a deletion marks the following surviving line DeletedBefore", () => {
		const lines = gutterLines("a\nb\nc", "a\nc");
		expect(lines[1]?.change).toBe(LineChange.DeletedBefore);
	});

	it("aligns one descriptor per current line even when statuses are shorter", () => {
		const content = "x\ny\nz\nw";
		const lines = gutterLines("x", content);
		expect(lines).toHaveLength(content.split("\n").length);
		expect(lines.every((l) => l.change !== undefined)).toBe(true);
	});
});
