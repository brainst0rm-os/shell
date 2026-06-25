import { describe, expect, it } from "vitest";
import {
	compareLocators,
	locatorsEqual,
	makeLocator,
	normalizeRange,
	parseLocator,
	parseRange,
	rangeIsCollapsed,
	serializeLocator,
	serializeRange,
} from "../types/locator";

describe("locator order + equality", () => {
	it("orders by spine then char offset", () => {
		expect(compareLocators(makeLocator(0, 5), makeLocator(0, 10))).toBeLessThan(0);
		expect(compareLocators(makeLocator(1, 0), makeLocator(0, 999))).toBeGreaterThan(0);
		expect(compareLocators(makeLocator(2, 4), makeLocator(2, 4))).toBe(0);
	});

	it("equals is total-order zero", () => {
		expect(locatorsEqual(makeLocator(1, 2), makeLocator(1, 2))).toBe(true);
		expect(locatorsEqual(makeLocator(1, 2), makeLocator(1, 3))).toBe(false);
	});
});

describe("range normalize + collapse", () => {
	it("swaps a backward range so start <= end", () => {
		const r = normalizeRange({ start: makeLocator(3, 0), end: makeLocator(1, 0) });
		expect(r.start).toEqual(makeLocator(1, 0));
		expect(r.end).toEqual(makeLocator(3, 0));
	});

	it("leaves a forward range untouched", () => {
		const forward = { start: makeLocator(0, 0), end: makeLocator(0, 5) };
		expect(normalizeRange(forward)).toBe(forward);
	});

	it("detects a collapsed caret range", () => {
		expect(rangeIsCollapsed({ start: makeLocator(0, 4), end: makeLocator(0, 4) })).toBe(true);
		expect(rangeIsCollapsed({ start: makeLocator(0, 4), end: makeLocator(0, 5) })).toBe(false);
	});
});

describe("CFI-style serialization round trip", () => {
	it("round-trips a locator", () => {
		const loc = makeLocator(2, 140);
		const wire = serializeLocator(loc);
		expect(wire).toBe("bkcfi:/2:140");
		expect(parseLocator(wire)).toEqual(loc);
	});

	it("rejects non-prefixed or malformed strings", () => {
		expect(parseLocator("2:140")).toBeNull();
		expect(parseLocator("bkcfi:/x:y")).toBeNull();
		expect(parseLocator("bkcfi:/2")).toBeNull();
	});

	it("round-trips a range", () => {
		const range = { start: makeLocator(0, 0), end: makeLocator(1, 12) };
		const wire = serializeRange(range);
		expect(parseRange(wire)).toEqual(range);
	});

	it("rejects a range with one bad endpoint", () => {
		expect(parseRange("bkcfi:/0:0,nope")).toBeNull();
		expect(parseRange("bkcfi:/0:0")).toBeNull();
	});
});
