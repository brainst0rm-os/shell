import { describe, expect, it } from "vitest";
import { SelectionModifier, computeRange, modifierFromEvent, toggleId } from "./selection";

const ORDER = ["a", "b", "c", "d", "e"];

describe("computeRange", () => {
	it("returns the inclusive forward range", () => {
		expect(computeRange("b", "d", ORDER)).toEqual(["b", "c", "d"]);
	});

	it("is direction-agnostic (anchor after target)", () => {
		expect(computeRange("d", "b", ORDER)).toEqual(["b", "c", "d"]);
	});

	it("returns a single id when anchor equals target", () => {
		expect(computeRange("c", "c", ORDER)).toEqual(["c"]);
	});

	it("falls back to [to] when either id is missing", () => {
		expect(computeRange("zzz", "c", ORDER)).toEqual(["c"]);
		expect(computeRange("c", "zzz", ORDER)).toEqual(["zzz"]);
	});
});

describe("toggleId", () => {
	it("adds an absent id and removes a present one without mutating the input", () => {
		const base = new Set(["a", "b"]);
		const added = toggleId(base, "c");
		expect([...added].sort()).toEqual(["a", "b", "c"]);
		expect([...base].sort()).toEqual(["a", "b"]);
		expect([...toggleId(base, "a")].sort()).toEqual(["b"]);
	});
});

describe("modifierFromEvent", () => {
	it("maps shift → Range, mod → Toggle, neither → None (shift wins)", () => {
		expect(modifierFromEvent({ shift: true, mod: false })).toBe(SelectionModifier.Range);
		expect(modifierFromEvent({ shift: false, mod: true })).toBe(SelectionModifier.Toggle);
		expect(modifierFromEvent({ shift: false, mod: false })).toBe(SelectionModifier.None);
		expect(modifierFromEvent({ shift: true, mod: true })).toBe(SelectionModifier.Range);
	});
});
