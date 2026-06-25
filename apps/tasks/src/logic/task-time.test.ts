import { describe, expect, it } from "vitest";
import { formatMinutes, parseDurationToMinutes } from "./task-time";

describe("task-time", () => {
	it("formatMinutes renders via formatDuration", () => {
		expect(formatMinutes(150)).toBe("2h 30m");
		expect(formatMinutes(45)).toBe("45m");
		expect(formatMinutes(120)).toBe("2h");
		expect(formatMinutes(0)).toBe("0h");
		expect(formatMinutes(null)).toBe("");
	});

	it("parseDurationToMinutes accepts h/m forms", () => {
		expect(parseDurationToMinutes("2h")).toBe(120);
		expect(parseDurationToMinutes("30m")).toBe(30);
		expect(parseDurationToMinutes("2h30m")).toBe(150);
		expect(parseDurationToMinutes("2h 30m")).toBe(150);
		expect(parseDurationToMinutes("1.5h")).toBe(90);
	});

	it("parseDurationToMinutes treats a bare number as minutes", () => {
		expect(parseDurationToMinutes("90")).toBe(90);
		expect(parseDurationToMinutes("0")).toBe(0);
	});

	it("parseDurationToMinutes rejects blank / invalid / negative", () => {
		expect(parseDurationToMinutes("")).toBeNull();
		expect(parseDurationToMinutes("   ")).toBeNull();
		expect(parseDurationToMinutes("soon")).toBeNull();
		expect(parseDurationToMinutes("-2h")).toBeNull();
	});

	it("round-trips a parsed value through the formatter", () => {
		const m = parseDurationToMinutes("3h15m");
		expect(m).toBe(195);
		expect(formatMinutes(m)).toBe("3h 15m");
	});
});
