import { describe, expect, it } from "vitest";
import { LineChange, diffLineStatuses, hasLineChanges } from "./line-diff";

describe("diffLineStatuses", () => {
	it("identical content → all unchanged", () => {
		expect(diffLineStatuses("a\nb\nc", "a\nb\nc")).toEqual([
			LineChange.Unchanged,
			LineChange.Unchanged,
			LineChange.Unchanged,
		]);
	});

	it("an appended line is Added", () => {
		expect(diffLineStatuses("a\nb", "a\nb\nc")).toEqual([
			LineChange.Unchanged,
			LineChange.Unchanged,
			LineChange.Added,
		]);
	});

	it("a changed line reads as Modified (delete+add adjacency)", () => {
		const s = diffLineStatuses("a\nb\nc", "a\nB\nc");
		expect(s[1]).toBe(LineChange.Modified);
		expect(s[0]).toBe(LineChange.Unchanged);
		expect(s[2]).toBe(LineChange.Unchanged);
	});

	it("a deletion marks the following surviving line", () => {
		const s = diffLineStatuses("a\nb\nc", "a\nc");
		expect(s[1]).toBe(LineChange.DeletedBefore);
	});

	it("a trailing deletion marks the last line", () => {
		const s = diffLineStatuses("a\nb\nc", "a\nb");
		expect(s[s.length - 1]).toBe(LineChange.DeletedBefore);
	});

	it("one entry per line of the current buffer", () => {
		const next = "x\ny\nz\nw";
		expect(diffLineStatuses("x", next)).toHaveLength(next.split("\n").length);
	});

	it("hasLineChanges is a cheap equality gate", () => {
		expect(hasLineChanges("a", "a")).toBe(false);
		expect(hasLineChanges("a", "b")).toBe(true);
	});
});
