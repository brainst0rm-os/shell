import { describe, expect, it } from "vitest";
import {
	currentStreak,
	densityBucket,
	longestStreak,
	previousDateKey,
	streakAtRisk,
} from "./streaks";

const set = (...keys: string[]) => new Set(keys);

describe("previousDateKey", () => {
	it("steps back one day, across month + year boundaries", () => {
		expect(previousDateKey("2026-06-05")).toBe("2026-06-04");
		expect(previousDateKey("2026-06-01")).toBe("2026-05-31");
		expect(previousDateKey("2026-01-01")).toBe("2025-12-31");
	});
});

describe("currentStreak", () => {
	it("counts consecutive days ending today", () => {
		const keys = set("2026-06-03", "2026-06-04", "2026-06-05");
		expect(currentStreak(keys, "2026-06-05")).toBe(3);
	});

	it("counts the still-extendable run ending yesterday when today is empty", () => {
		const keys = set("2026-06-03", "2026-06-04");
		expect(currentStreak(keys, "2026-06-05")).toBe(2);
	});

	it("is 0 once two days in a row are missed", () => {
		const keys = set("2026-06-01", "2026-06-02");
		expect(currentStreak(keys, "2026-06-05")).toBe(0);
	});

	it("ignores a gap before today's run", () => {
		const keys = set("2026-05-20", "2026-06-04", "2026-06-05");
		expect(currentStreak(keys, "2026-06-05")).toBe(2);
	});
});

describe("longestStreak", () => {
	it("finds the longest run anywhere, measuring each run once", () => {
		const keys = set(
			"2026-01-01",
			"2026-01-02",
			"2026-01-03", // run of 3
			"2026-02-10",
			"2026-02-11", // run of 2
		);
		expect(longestStreak(keys)).toBe(3);
	});

	it("is 0 for no entries and 1 for a lone day", () => {
		expect(longestStreak(set())).toBe(0);
		expect(longestStreak(set("2026-06-05"))).toBe(1);
	});
});

describe("streakAtRisk", () => {
	it("is the run ending yesterday when today is unwritten", () => {
		const keys = set("2026-05-11", "2026-05-12", "2026-05-13");
		expect(streakAtRisk(keys, "2026-05-14")).toBe(3);
	});

	it("is 0 once today is written (nothing at risk)", () => {
		const keys = set("2026-05-12", "2026-05-13", "2026-05-14");
		expect(streakAtRisk(keys, "2026-05-14")).toBe(0);
	});

	it("is 0 when yesterday was already missed (streak already gone)", () => {
		const keys = set("2026-05-10", "2026-05-11");
		expect(streakAtRisk(keys, "2026-05-14")).toBe(0);
	});
});

describe("densityBucket", () => {
	it("buckets by word count", () => {
		expect(densityBucket(0)).toBe(0);
		expect(densityBucket(10)).toBe(1);
		expect(densityBucket(50)).toBe(1);
		expect(densityBucket(120)).toBe(2);
		expect(densityBucket(200)).toBe(2);
		expect(densityBucket(500)).toBe(3);
	});
});
