/**
 * Pure rich-run transforms (9.17.12 rest): normalization invariants, range
 * splitting at run boundaries, toggle semantics, uniform-style queries, and
 * the persisted-form reduction. The DOM bridge has its own suite.
 */

import { describe, expect, it } from "vitest";
import { TextColor, TextSize } from "../types/node";
import { RichMark, type RichRun, coerceRichRuns } from "../types/rich-text";
import {
	applyMarkToRange,
	marksInRange,
	normalizeRuns,
	plainToRich,
	rangeFullyMarked,
	richRunsEqual,
	richTextLength,
	richToPlain,
	setColorInRange,
	setSizeInRange,
	stylesInRange,
	toPersistedRich,
	toggleMarkInRange,
	uniformColorInRange,
	uniformSizeInRange,
} from "./rich-text";

describe("plain round-trip", () => {
	it("plainToRich/richToPlain round-trips and empty text yields no runs", () => {
		expect(plainToRich("")).toEqual([]);
		expect(richToPlain(plainToRich("hello\nworld"))).toBe("hello\nworld");
		expect(richTextLength(plainToRich("hello"))).toBe(5);
	});
});

describe("normalizeRuns", () => {
	it("drops empty runs and merges adjacent equal-style runs", () => {
		const runs: RichRun[] = [
			{ text: "a", bold: true },
			{ text: "" },
			{ text: "b", bold: true },
			{ text: "c" },
		];
		expect(normalizeRuns(runs)).toEqual([{ text: "ab", bold: true }, { text: "c" }]);
	});

	it("does not merge runs whose styles differ", () => {
		const runs: RichRun[] = [
			{ text: "a", color: TextColor.Red },
			{ text: "b", color: TextColor.Blue },
		];
		expect(normalizeRuns(runs)).toHaveLength(2);
	});
});

describe("applyMarkToRange / toggleMarkInRange", () => {
	const base: RichRun[] = [{ text: "hello world" }];

	it("splits a run at the range boundaries", () => {
		const next = applyMarkToRange(base, 6, 11, RichMark.Bold, true);
		expect(next).toEqual([{ text: "hello " }, { text: "world", bold: true }]);
		expect(richToPlain(next)).toBe("hello world");
	});

	it("clamps out-of-bounds ranges and ignores empty ones", () => {
		expect(applyMarkToRange(base, -5, 99, RichMark.Italic, true)).toEqual([
			{ text: "hello world", italic: true },
		]);
		expect(applyMarkToRange(base, 4, 4, RichMark.Bold, true)).toEqual(base);
	});

	it("toggle sets the mark when partially marked, clears when fully marked", () => {
		const partly = applyMarkToRange(base, 0, 5, RichMark.Bold, true);
		const all = toggleMarkInRange(partly, 0, 11, RichMark.Bold);
		expect(rangeFullyMarked(all, 0, 11, RichMark.Bold)).toBe(true);
		const cleared = toggleMarkInRange(all, 0, 11, RichMark.Bold);
		expect(cleared).toEqual([{ text: "hello world" }]);
	});

	it("preserves other styles across a mark application", () => {
		const styled: RichRun[] = [{ text: "abc", color: TextColor.Green, size: TextSize.Large }];
		const next = applyMarkToRange(styled, 1, 2, RichMark.Underline, true);
		expect(next).toEqual([
			{ text: "a", color: TextColor.Green, size: TextSize.Large },
			{ text: "b", color: TextColor.Green, size: TextSize.Large, underline: true },
			{ text: "c", color: TextColor.Green, size: TextSize.Large },
		]);
	});
});

describe("color / size ranges", () => {
	it("sets and clears the per-run colour", () => {
		const colored = setColorInRange([{ text: "abcd" }], 1, 3, TextColor.Purple);
		expect(colored).toEqual([{ text: "a" }, { text: "bc", color: TextColor.Purple }, { text: "d" }]);
		expect(setColorInRange(colored, 0, 4, null)).toEqual([{ text: "abcd" }]);
	});

	it("sets and clears the per-run size", () => {
		const sized = setSizeInRange([{ text: "abcd" }], 0, 2, TextSize.Small);
		expect(sized).toEqual([{ text: "ab", size: TextSize.Small }, { text: "cd" }]);
		expect(setSizeInRange(sized, 0, 4, null)).toEqual([{ text: "abcd" }]);
	});

	it("uniform queries report a value only when the whole range agrees", () => {
		const runs = setColorInRange([{ text: "abcd" }], 0, 2, TextColor.Red);
		expect(uniformColorInRange(runs, 0, 2)).toBe(TextColor.Red);
		expect(uniformColorInRange(runs, 0, 4)).toBeNull();
		expect(uniformSizeInRange(runs, 0, 4)).toBeNull();
		expect(uniformColorInRange(runs, 2, 2)).toBeNull();
	});

	it("stylesInRange bundles marks + uniform colour/size", () => {
		let runs: RichRun[] = [{ text: "abcd" }];
		runs = applyMarkToRange(runs, 0, 4, RichMark.Bold, true);
		runs = setSizeInRange(runs, 0, 4, TextSize.Large);
		const styles = stylesInRange(runs, 1, 3);
		expect(styles.marks).toEqual(new Set([RichMark.Bold]));
		expect(styles.size).toBe(TextSize.Large);
		expect(styles.color).toBeNull();
		expect(marksInRange(runs, 0, 0).size).toBe(0);
	});
});

describe("persisted form", () => {
	it("reduces unstyled runs to null and keeps styled ones normalized", () => {
		expect(toPersistedRich([{ text: "plain" }, { text: " text" }])).toBeNull();
		expect(toPersistedRich([])).toBeNull();
		expect(
			toPersistedRich([
				{ text: "a", bold: true },
				{ text: "b", bold: true },
			]),
		).toEqual([{ text: "ab", bold: true }]);
	});

	it("richRunsEqual compares normalized forms", () => {
		expect(
			richRunsEqual(
				[{ text: "ab", bold: true }],
				[
					{ text: "a", bold: true },
					{ text: "b", bold: true },
				],
			),
		).toBe(true);
		expect(richRunsEqual([{ text: "ab" }], [{ text: "ab", bold: true }])).toBe(false);
	});
});

describe("coerceRichRuns (codec hardening)", () => {
	it("drops bad runs and bad fields, returns null for nothing usable", () => {
		expect(coerceRichRuns("nope")).toBeNull();
		expect(coerceRichRuns([])).toBeNull();
		expect(coerceRichRuns([{ text: "" }, { nope: 1 }, null])).toBeNull();
		expect(
			coerceRichRuns([
				{ text: "ok", bold: true, italic: "yes", color: "red", size: "huge" },
				{ text: "d", color: "default" },
			]),
		).toEqual([{ text: "ok", bold: true, color: TextColor.Red }, { text: "d" }]);
	});
});
