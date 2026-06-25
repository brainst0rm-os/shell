import { describe, expect, it } from "vitest";
import { formulaColumnId } from "./formula";
import {
	FormulaDraftErrorKind,
	defaultFormulaName,
	formulaAlreadyAdded,
	validateFormulaDraft,
} from "./formula-author";

describe("defaultFormulaName", () => {
	it("uses the trimmed expression as the name", () => {
		expect(defaultFormulaName("  {fee} * {qty} ")).toBe("{fee} * {qty}");
	});

	it("truncates a long expression with an ellipsis", () => {
		const long = `{${"x".repeat(60)}}`;
		const name = defaultFormulaName(long);
		expect(name.length).toBe(40);
		expect(name.endsWith("…")).toBe(true);
	});
});

describe("validateFormulaDraft", () => {
	const keys = ["fee", "quantity"];

	it("builds a column from a valid expression over known keys", () => {
		const result = validateFormulaDraft({ expression: "{fee} * {quantity}" }, keys);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.column.propertyId).toBe(formulaColumnId("{fee} * {quantity}"));
		expect(result.column.formula).toEqual({
			expression: "{fee} * {quantity}",
			name: "{fee} * {quantity}",
		});
		expect(result.column.visible).toBe(true);
	});

	it("trims the expression before building", () => {
		const result = validateFormulaDraft({ expression: "  {fee} + 1  " }, keys);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.column.formula?.expression).toBe("{fee} + 1");
	});

	it("uses an explicit name when provided", () => {
		const result = validateFormulaDraft({ expression: "{fee} + 1", name: "  Total  " }, keys);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.column.formula?.name).toBe("Total");
	});

	it("falls back to the expression when the name is blank", () => {
		const result = validateFormulaDraft({ expression: "{fee} + 1", name: "   " }, keys);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.column.formula?.name).toBe("{fee} + 1");
	});

	it("reports an empty expression", () => {
		const result = validateFormulaDraft({ expression: "   " }, keys);
		expect(result).toEqual({
			ok: false,
			kind: FormulaDraftErrorKind.Empty,
			message: "Enter a formula",
		});
	});

	it("reports a syntax error from the engine", () => {
		const result = validateFormulaDraft({ expression: "{fee} +" }, keys);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.kind).toBe(FormulaDraftErrorKind.Syntax);
		expect(result.message.length).toBeGreaterThan(0);
	});

	it("rejects an over-long expression as a syntax error", () => {
		const result = validateFormulaDraft({ expression: `1${"+1".repeat(2000)}` }, keys);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.kind).toBe(FormulaDraftErrorKind.Syntax);
	});

	it("flags a single unknown reference (recoverable)", () => {
		const result = validateFormulaDraft({ expression: "{margin} + 1" }, keys);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.kind).toBe(FormulaDraftErrorKind.UnknownReference);
		expect(result.unknownRefs).toEqual(["margin"]);
		expect(result.message).toContain("margin");
	});

	it("lists multiple unknown references", () => {
		const result = validateFormulaDraft({ expression: "{a} + {b} + {fee}" }, keys);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.kind).toBe(FormulaDraftErrorKind.UnknownReference);
		expect(result.unknownRefs).toEqual(["a", "b"]);
		expect(result.message).toContain("a, b");
	});

	it("accepts a literal-only expression with no references", () => {
		const result = validateFormulaDraft({ expression: "2 + 3 * 4" }, []);
		expect(result.ok).toBe(true);
	});
});

describe("formulaAlreadyAdded", () => {
	it("detects an existing column with the same expression", () => {
		const columns = [validatedColumn("{fee} * 2")];
		expect(formulaAlreadyAdded(columns, "{fee} * 2")).toBe(true);
		expect(formulaAlreadyAdded(columns, " {fee} * 2 ")).toBe(true);
		expect(formulaAlreadyAdded(columns, "{fee} * 3")).toBe(false);
	});

	it("is false against an empty column set", () => {
		expect(formulaAlreadyAdded([], "{fee}")).toBe(false);
	});
});

function validatedColumn(expression: string) {
	const result = validateFormulaDraft({ expression }, ["fee"]);
	if (!result.ok) throw new Error("expected ok");
	return result.column;
}
