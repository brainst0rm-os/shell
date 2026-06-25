import { describe, expect, it } from "vitest";
import { compileFormula, evaluateFormula, formulaReferences } from "./formula";

/** A resolver from a plain record. */
const row = (values: Record<string, unknown>) => (key: string) => values[key];

describe("evaluateFormula — arithmetic", () => {
	it("evaluates numeric literals + operator precedence", () => {
		expect(evaluateFormula("2 + 3 * 4", row({}))).toEqual({ ok: true, value: 14 });
		expect(evaluateFormula("(2 + 3) * 4", row({}))).toEqual({ ok: true, value: 20 });
		expect(evaluateFormula("10 / 4", row({}))).toEqual({ ok: true, value: 2.5 });
		expect(evaluateFormula("-3 + 5", row({}))).toEqual({ ok: true, value: 2 });
		expect(evaluateFormula("2.5 * 2", row({}))).toEqual({ ok: true, value: 5 });
	});

	it("resolves property references", () => {
		const r = row({ fee: 1000, quantity: 4 });
		expect(evaluateFormula("{fee} * {quantity}", r)).toEqual({ ok: true, value: 4000 });
		expect(evaluateFormula("{fee} / {quantity}", r)).toEqual({ ok: true, value: 250 });
	});

	it("trims whitespace inside references", () => {
		expect(evaluateFormula("{ fee } + 1", row({ fee: 9 }))).toEqual({ ok: true, value: 10 });
	});

	it("coerces numeric strings but rejects non-numeric values", () => {
		expect(evaluateFormula("{a} + 1", row({ a: "41" }))).toEqual({ ok: true, value: 42 });
		expect(evaluateFormula("{a} + 1", row({ a: "abc" }))).toEqual({
			ok: false,
			error: "{a} is not a number",
		});
		expect(evaluateFormula("{a} + 1", row({}))).toEqual({
			ok: false,
			error: "{a} is not a number",
		});
	});
});

describe("evaluateFormula — errors", () => {
	it("reports division by zero", () => {
		expect(evaluateFormula("1 / 0", row({}))).toEqual({ ok: false, error: "Division by zero" });
		expect(evaluateFormula("{a} / {b}", row({ a: 5, b: 0 }))).toEqual({
			ok: false,
			error: "Division by zero",
		});
	});

	it("rejects an empty expression", () => {
		expect(evaluateFormula("   ", row({}))).toEqual({ ok: false, error: "Empty formula" });
	});

	it("reports syntax errors at compile", () => {
		expect(compileFormula("2 +").ok).toBe(false);
		expect(compileFormula("(2 + 3").ok).toBe(false);
		expect(compileFormula("{unclosed").ok).toBe(false);
		expect(compileFormula("{}").ok).toBe(false);
		expect(compileFormula("2 @ 3").ok).toBe(false);
		expect(compileFormula("2 3").ok).toBe(false);
	});
});

describe("compileFormula — reuse", () => {
	it("compiles once and evaluates per row", () => {
		const compiled = compileFormula("{price} * {qty}");
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) return;
		expect(compiled.formula.evaluate(row({ price: 2, qty: 3 }))).toEqual({ ok: true, value: 6 });
		expect(compiled.formula.evaluate(row({ price: 5, qty: 5 }))).toEqual({ ok: true, value: 25 });
	});

	it("exposes the distinct referenced keys", () => {
		const compiled = compileFormula("{a} + {b} * {a}");
		expect(compiled.ok).toBe(true);
		if (!compiled.ok) return;
		expect([...compiled.formula.refs].sort()).toEqual(["a", "b"]);
	});
});

describe("formulaReferences", () => {
	it("lists referenced keys, tolerating a malformed expression", () => {
		expect(formulaReferences("{fee} + {tax}").sort()).toEqual(["fee", "tax"]);
		expect(formulaReferences("garbage @@@")).toEqual([]);
		expect(formulaReferences("2 + 2")).toEqual([]);
	});
});

describe("compileFormula — input bound (DoS guard)", () => {
	it("rejects an over-length formula up front (fail-closed, no stack risk)", () => {
		const huge = `${"(".repeat(20000)}1${")".repeat(20000)}`;
		const r = compileFormula(huge);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("too long");
	});
	it("accepts a normal-length nested expression", () => {
		expect(compileFormula("(({fee} + 1) * 2) - 3").ok).toBe(true);
	});
});
