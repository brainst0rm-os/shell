import { describe, expect, it } from "vitest";
import { enumGuard } from "./enum-guard";

enum Color {
	Red = "red",
	Blue = "blue",
}
const COLORS = Object.freeze([Color.Red, Color.Blue]) as readonly Color[];

describe("enumGuard", () => {
	const isColor = enumGuard(COLORS);

	it("is true only for string members of the table", () => {
		expect(isColor("red")).toBe(true);
		expect(isColor(Color.Blue)).toBe(true);
		expect(isColor("green")).toBe(false);
		expect(isColor("")).toBe(false);
	});

	it("is false for every non-string (no throw)", () => {
		for (const x of [null, undefined, 0, 1, Number.NaN, {}, [], true, Symbol("red")]) {
			expect(isColor(x)).toBe(false);
		}
	});

	it("narrows the type at the call site", () => {
		const v: unknown = "blue";
		if (isColor(v)) {
			// `v` is `Color` here — assignable to the union, usable as such.
			const c: Color = v;
			expect(c).toBe(Color.Blue);
		} else {
			throw new Error("expected narrowing");
		}
	});

	it("an empty table guard is always false", () => {
		const never = enumGuard([] as readonly string[]);
		expect(never("anything")).toBe(false);
		expect(never("")).toBe(false);
	});

	it("works over a plain (non-frozen) string array too", () => {
		const isFruit = enumGuard(["apple", "pear"]);
		expect(isFruit("apple")).toBe(true);
		expect(isFruit("apple ")).toBe(false); // exact match only
	});
});
