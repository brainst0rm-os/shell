import { describe, expect, it } from "vitest";
import { DiffRowKind, buildDiffRows, diffStats, hasDiff } from "./diff-rows";

describe("buildDiffRows", () => {
	it("identical sides are all context", () => {
		const rows = buildDiffRows("a\nb\nc", "a\nb\nc");
		expect(rows.map((r) => r.kind)).toEqual([
			DiffRowKind.Context,
			DiffRowKind.Context,
			DiffRowKind.Context,
		]);
		expect(rows.map((r) => r.text)).toEqual(["a", "b", "c"]);
		expect(rows.map((r) => r.baseLine)).toEqual([1, 2, 3]);
		expect(rows.map((r) => r.nextLine)).toEqual([1, 2, 3]);
	});

	it("an appended line is a trailing Added row", () => {
		const rows = buildDiffRows("a\nb", "a\nb\nc");
		expect(rows[2]).toEqual({
			kind: DiffRowKind.Added,
			baseLine: null,
			nextLine: 3,
			text: "c",
		});
	});

	it("a removed line is a Removed row carrying the base text", () => {
		const rows = buildDiffRows("a\nb\nc", "a\nc");
		const removed = rows.find((r) => r.kind === DiffRowKind.Removed);
		expect(removed).toEqual({
			kind: DiffRowKind.Removed,
			baseLine: 2,
			nextLine: null,
			text: "b",
		});
	});

	it("a modified line is removed-then-added", () => {
		const rows = buildDiffRows("a\nb\nc", "a\nB\nc");
		const kinds = rows.map((r) => r.kind);
		const removeIdx = kinds.indexOf(DiffRowKind.Removed);
		const addIdx = kinds.indexOf(DiffRowKind.Added);
		expect(removeIdx).toBeGreaterThanOrEqual(0);
		expect(addIdx).toBe(removeIdx + 1);
		expect(rows[removeIdx]?.text).toBe("b");
		expect(rows[addIdx]?.text).toBe("B");
	});

	it("base empty → every next line is Added", () => {
		const rows = buildDiffRows("", "x\ny");
		expect(rows.every((r) => r.kind === DiffRowKind.Added)).toBe(true);
		expect(rows.map((r) => r.nextLine)).toEqual([1, 2]);
	});

	it("next empty → every base line is Removed", () => {
		const rows = buildDiffRows("x\ny", "");
		expect(rows.every((r) => r.kind === DiffRowKind.Removed)).toBe(true);
		expect(rows.map((r) => r.baseLine)).toEqual([1, 2]);
	});

	it("both empty → no rows", () => {
		expect(buildDiffRows("", "")).toEqual([]);
	});
});

describe("diffStats", () => {
	it("counts added and removed rows", () => {
		const rows = buildDiffRows("a\nb\nc", "a\nB\nc\nd");
		expect(diffStats(rows)).toEqual({ added: 2, removed: 1 });
	});

	it("an unchanged diff has zero stats", () => {
		expect(diffStats(buildDiffRows("a", "a"))).toEqual({ added: 0, removed: 0 });
	});
});

describe("hasDiff", () => {
	it("false when identical", () => {
		expect(hasDiff(buildDiffRows("a\nb", "a\nb"))).toBe(false);
	});

	it("true when changed", () => {
		expect(hasDiff(buildDiffRows("a\nb", "a\nc"))).toBe(true);
	});
});
