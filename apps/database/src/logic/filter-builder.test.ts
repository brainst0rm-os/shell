import { describe, expect, it } from "vitest";
import { FilterGroupOp } from "../types/predicate";
import {
	FILTER_OPERATORS,
	FilterOp,
	type FilterRule,
	draftToFilterNode,
	filterNodeToDraft,
	isRuleComplete,
	opLabel,
	ruleToPredicate,
} from "./filter-builder";

describe("filter-builder — $relativeDate operator (9.12.20)", () => {
	const rule = (over: Partial<FilterRule> = {}): FilterRule => ({
		propertyId: "due",
		op: FilterOp.RelativeDate,
		value: "last7Days",
		...over,
	});

	it("is offered in the operator catalogue as a value op", () => {
		const entry = FILTER_OPERATORS.find((o) => o.op === FilterOp.RelativeDate);
		expect(entry).toBeDefined();
		expect(entry?.needsValue).toBe(true);
		expect(opLabel(FilterOp.RelativeDate)).toBe("is in");
	});

	it("compiles to a $relativeDate predicate carrying the range token", () => {
		expect(ruleToPredicate(rule())).toEqual({ $relativeDate: { due: "last7Days" } });
	});

	it("is incomplete (dropped) with no chosen range", () => {
		expect(isRuleComplete(rule({ value: "" }))).toBe(false);
		expect(ruleToPredicate(rule({ value: "" }))).toBeNull();
	});

	it("round-trips through the FilterNode tree (re-opening the builder)", () => {
		const draft = { op: FilterGroupOp.And, rules: [rule()] };
		const node = draftToFilterNode(draft);
		expect(node).not.toBeNull();
		const back = filterNodeToDraft(node);
		expect(back.rules).toEqual([
			{ propertyId: "due", op: FilterOp.RelativeDate, value: "last7Days" },
		]);
	});
});
