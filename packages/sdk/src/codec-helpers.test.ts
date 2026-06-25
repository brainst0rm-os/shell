import { describe, expect, it } from "vitest";
import { coerceEnum, nullableNumber, nullableString } from "./codec-helpers";

describe("nullableNumber", () => {
	it("keeps finite numbers, rejects everything else", () => {
		expect(nullableNumber(0)).toBe(0);
		expect(nullableNumber(-3.5)).toBe(-3.5);
		expect(nullableNumber(Number.NaN)).toBeNull();
		expect(nullableNumber(Number.POSITIVE_INFINITY)).toBeNull();
		expect(nullableNumber("5")).toBeNull();
		expect(nullableNumber(null)).toBeNull();
		expect(nullableNumber(undefined)).toBeNull();
	});
});

describe("nullableString", () => {
	it("keeps strings (incl. empty), rejects everything else", () => {
		expect(nullableString("")).toBe("");
		expect(nullableString("hi")).toBe("hi");
		expect(nullableString(5)).toBeNull();
		expect(nullableString(null)).toBeNull();
		expect(nullableString(undefined)).toBeNull();
	});
});

describe("coerceEnum", () => {
	const COLORS = ["red", "green", "blue"] as const;
	it("returns the value when it's a member, else null", () => {
		expect(coerceEnum("green", COLORS)).toBe("green");
		expect(coerceEnum("purple", COLORS)).toBeNull();
		expect(coerceEnum(2, COLORS)).toBeNull();
		expect(coerceEnum(undefined, COLORS)).toBeNull();
	});
});
