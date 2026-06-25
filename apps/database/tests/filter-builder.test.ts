/**
 * Filter v2 model. Proves the rule↔predicate mapping, value coercion, the
 * incomplete-rule drop, and that v1's single-`$contains` view is a strict
 * round-tripping subset (no persisted-view migration needed).
 */

import { describe, expect, it } from "vitest";
import {
	FilterOp,
	countDraftRules,
	describeGroup,
	describeRule,
	draftToFilterNode,
	filterNodeToDraft,
	isDraftEmpty,
	isRuleComplete,
	opAcceptsRef,
	opIsList,
	opNeedsValue,
	ruleToPredicate,
} from "../src/logic/filter-builder";
import { FilterGroupOp, FilterNodeKind } from "../src/types/predicate";

describe("ruleToPredicate", () => {
	it("maps each op to its predicate key", () => {
		expect(ruleToPredicate({ propertyId: "name", op: FilterOp.Contains, value: "ab" })).toEqual({
			$contains: { name: "ab" },
		});
		expect(ruleToPredicate({ propertyId: "name", op: FilterOp.Like, value: "a%" })).toEqual({
			$like: { name: "a%" },
		});
		expect(ruleToPredicate({ propertyId: "x", op: FilterOp.Exists, value: "" })).toEqual({
			$exists: { x: true },
		});
		expect(ruleToPredicate({ propertyId: "x", op: FilterOp.Empty, value: "" })).toEqual({
			$empty: { x: true },
		});
	});

	it("coerces eq values: boolean / number / string", () => {
		expect(ruleToPredicate({ propertyId: "done", op: FilterOp.Eq, value: "true" })).toEqual({
			$eq: { done: true },
		});
		expect(ruleToPredicate({ propertyId: "n", op: FilterOp.Eq, value: "42" })).toEqual({
			$eq: { n: 42 },
		});
		expect(ruleToPredicate({ propertyId: "s", op: FilterOp.Eq, value: "Done" })).toEqual({
			$eq: { s: "Done" },
		});
	});

	it("keeps numeric strings numeric for comparison ops, never boolean", () => {
		expect(ruleToPredicate({ propertyId: "p", op: FilterOp.Gt, value: "5" })).toEqual({
			$gt: { p: 5 },
		});
		expect(ruleToPredicate({ propertyId: "p", op: FilterOp.Lte, value: "true" })).toEqual({
			$lte: { p: "true" },
		});
	});

	it("does not number-coerce contains (substring semantics)", () => {
		expect(ruleToPredicate({ propertyId: "code", op: FilterOp.Contains, value: "42" })).toEqual({
			$contains: { code: "42" },
		});
	});

	it("returns null for an incomplete rule", () => {
		expect(ruleToPredicate({ propertyId: "", op: FilterOp.Eq, value: "x" })).toBeNull();
		expect(ruleToPredicate({ propertyId: "n", op: FilterOp.Eq, value: "  " })).toBeNull();
		expect(ruleToPredicate({ propertyId: "n", op: FilterOp.Exists, value: "" })).not.toBeNull();
	});
});

describe("isRuleComplete / opNeedsValue", () => {
	it("value ops need a non-empty value; exists/empty do not", () => {
		expect(opNeedsValue(FilterOp.Contains)).toBe(true);
		expect(opNeedsValue(FilterOp.Exists)).toBe(false);
		expect(isRuleComplete({ propertyId: "a", op: FilterOp.Exists, value: "" })).toBe(true);
		expect(isRuleComplete({ propertyId: "a", op: FilterOp.Contains, value: "" })).toBe(false);
		expect(isRuleComplete({ propertyId: "", op: FilterOp.Exists, value: "" })).toBe(false);
	});
});

describe("draftToFilterNode", () => {
	it("builds an op-tagged group, dropping incomplete rules", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.Or,
			rules: [
				{ propertyId: "status", op: FilterOp.Eq, value: "Done" },
				{ propertyId: "", op: FilterOp.Eq, value: "ignored" },
				{ propertyId: "p", op: FilterOp.Gt, value: "3" },
			],
		});
		expect(node).toEqual({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.Or,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } },
				{ kind: FilterNodeKind.Predicate, predicate: { $gt: { p: 3 } } },
			],
		});
	});

	it("returns null when no rule is complete", () => {
		expect(
			draftToFilterNode({
				op: FilterGroupOp.And,
				rules: [{ propertyId: "", op: FilterOp.Eq, value: "" }],
			}),
		).toBeNull();
		expect(draftToFilterNode({ op: FilterGroupOp.And, rules: [] })).toBeNull();
	});
});

describe("filterNodeToDraft", () => {
	it("round-trips a multi-rule draft", () => {
		const draft = {
			op: FilterGroupOp.Or,
			rules: [
				{ propertyId: "status", op: FilterOp.Eq, value: "Done" },
				{ propertyId: "title", op: FilterOp.Contains, value: "spec" },
				{ propertyId: "due", op: FilterOp.Exists, value: "" },
			],
		};
		expect(filterNodeToDraft(draftToFilterNode(draft))).toEqual(draft);
	});

	it("treats v1's single-$contains group as a one-rule AND draft (no migration)", () => {
		const v1 = {
			kind: FilterNodeKind.Group as const,
			op: FilterGroupOp.And,
			children: [
				{ kind: FilterNodeKind.Predicate as const, predicate: { $contains: { name: "abc" } } },
			],
		};
		expect(filterNodeToDraft(v1)).toEqual({
			op: FilterGroupOp.And,
			rules: [{ propertyId: "name", op: FilterOp.Contains, value: "abc" }],
		});
	});

	it("a bare predicate node becomes a one-rule AND draft", () => {
		expect(
			filterNodeToDraft({ kind: FilterNodeKind.Predicate, predicate: { $eq: { a: 1 } } }),
		).toEqual({ op: FilterGroupOp.And, rules: [{ propertyId: "a", op: FilterOp.Eq, value: "1" }] });
	});

	it("yields an empty draft for null or shapes outside the flat model", () => {
		expect(filterNodeToDraft(null)).toEqual({ op: FilterGroupOp.And, rules: [] });
		expect(
			filterNodeToDraft({ kind: FilterNodeKind.Predicate, predicate: { $not: { $eq: { a: 1 } } } }),
		).toEqual({ op: FilterGroupOp.And, rules: [] });
	});
});

describe("describeRule", () => {
	it("quotes the value for value ops and omits it for set/empty", () => {
		expect(describeRule({ propertyId: "status", op: FilterOp.Eq, value: "Done" }, "Status")).toBe(
			'Status is "Done"',
		);
		expect(describeRule({ propertyId: "due", op: FilterOp.Exists, value: "" }, "Due")).toBe(
			"Due is set",
		);
	});
});

describe("$in-family multi-value (v2.1a)", () => {
	it("flags the list ops via opIsList and they still need a value", () => {
		for (const op of [FilterOp.In, FilterOp.AllIn, FilterOp.NotIn]) {
			expect(opIsList(op)).toBe(true);
			expect(opNeedsValue(op)).toBe(true);
		}
		expect(opIsList(FilterOp.Eq)).toBe(false);
	});

	it("parses a comma-separated value into a coerced scalar list", () => {
		expect(ruleToPredicate({ propertyId: "tag", op: FilterOp.In, value: "a, b ,c" })).toEqual({
			$in: { tag: ["a", "b", "c"] },
		});
		expect(ruleToPredicate({ propertyId: "n", op: FilterOp.AllIn, value: "1, 2, true" })).toEqual({
			$allIn: { n: [1, 2, true] },
		});
		expect(ruleToPredicate({ propertyId: "x", op: FilterOp.NotIn, value: "z" })).toEqual({
			$notIn: { x: ["z"] },
		});
	});

	it("drops empty entries and treats an all-blank list as incomplete", () => {
		expect(ruleToPredicate({ propertyId: "t", op: FilterOp.In, value: "a, , b" })).toEqual({
			$in: { t: ["a", "b"] },
		});
		expect(isRuleComplete({ propertyId: "t", op: FilterOp.In, value: " , , " })).toBe(false);
		expect(ruleToPredicate({ propertyId: "t", op: FilterOp.In, value: "  " })).toBeNull();
		expect(isRuleComplete({ propertyId: "t", op: FilterOp.In, value: "a" })).toBe(true);
	});

	it("round-trips a list predicate back to a comma-joined rule", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.And,
			rules: [{ propertyId: "tag", op: FilterOp.In, value: "x, y" }],
		});
		expect(filterNodeToDraft(node)).toEqual({
			op: FilterGroupOp.And,
			rules: [{ propertyId: "tag", op: FilterOp.In, value: "x, y" }],
		});
	});

	it("describes a list rule with the joined value quoted", () => {
		expect(describeRule({ propertyId: "tag", op: FilterOp.NotIn, value: "draft, wip" }, "Tag")).toBe(
			'Tag is none of "draft, wip"',
		);
	});
});

describe("Filter v2.1b — nested groups", () => {
	const rule = (propertyId: string, value: string) => ({
		propertyId,
		op: FilterOp.Eq,
		value,
	});

	it("flat draft (no groups) is byte-identical to the pre-v2.1b output", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.And,
			rules: [rule("a", "1"), rule("b", "2")],
		});
		expect(node).toEqual({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { a: 1 } } },
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { b: 2 } } },
			],
		});
	});

	it("compiles A AND (B OR C) — rule children then group children", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.And,
			rules: [rule("a", "1")],
			groups: [{ op: FilterGroupOp.Or, rules: [rule("b", "2"), rule("c", "3")] }],
		});
		expect(node).toEqual({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { a: 1 } } },
				{
					kind: FilterNodeKind.Group,
					op: FilterGroupOp.Or,
					children: [
						{ kind: FilterNodeKind.Predicate, predicate: { $eq: { b: 2 } } },
						{ kind: FilterNodeKind.Predicate, predicate: { $eq: { c: 3 } } },
					],
				},
			],
		});
	});

	it("prunes an empty / all-incomplete sub-group (never filters everything out)", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.And,
			rules: [rule("a", "1")],
			groups: [
				{ op: FilterGroupOp.Or, rules: [] },
				{ op: FilterGroupOp.And, rules: [{ propertyId: "", op: FilterOp.Eq, value: "" }] },
			],
		});
		// Only the one real rule survives — both groups dropped.
		expect(node).toEqual({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [{ kind: FilterNodeKind.Predicate, predicate: { $eq: { a: 1 } } }],
		});
	});

	it("a draft whose only content is empty groups compiles to null", () => {
		expect(
			draftToFilterNode({
				op: FilterGroupOp.And,
				rules: [],
				groups: [{ op: FilterGroupOp.Or, rules: [] }],
			}),
		).toBeNull();
	});

	it("round-trips a 3-level tree losslessly (node → draft → node)", () => {
		const draft = {
			op: FilterGroupOp.And,
			rules: [rule("a", "1")],
			groups: [
				{
					op: FilterGroupOp.Or,
					rules: [rule("b", "2")],
					groups: [{ op: FilterGroupOp.And, rules: [rule("c", "3"), rule("d", "4")] }],
				},
			],
		};
		const node = draftToFilterNode(draft);
		expect(node).not.toBeNull();
		// node → draft → node must be a fixpoint.
		expect(draftToFilterNode(filterNodeToDraft(node))).toEqual(node);
	});

	it("filterNodeToDraft reconstructs nested groups instead of flattening them", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.Or,
			rules: [rule("x", "1")],
			groups: [{ op: FilterGroupOp.And, rules: [rule("y", "2")] }],
		});
		const back = filterNodeToDraft(node);
		expect(back.op).toBe(FilterGroupOp.Or);
		expect(back.rules.map((r) => r.propertyId)).toEqual(["x"]);
		expect(back.groups?.length).toBe(1);
		expect(back.groups?.[0]?.op).toBe(FilterGroupOp.And);
		expect(back.groups?.[0]?.rules.map((r) => r.propertyId)).toEqual(["y"]);
	});

	it("countDraftRules / isDraftEmpty walk the whole tree (complete rules only)", () => {
		const draft = {
			op: FilterGroupOp.And,
			rules: [rule("a", "1"), { propertyId: "", op: FilterOp.Eq, value: "" }],
			groups: [{ op: FilterGroupOp.Or, rules: [rule("b", "2"), rule("c", "3")] }],
		};
		expect(countDraftRules(draft)).toBe(3);
		expect(isDraftEmpty(draft)).toBe(false);
		expect(
			isDraftEmpty({
				op: FilterGroupOp.And,
				rules: [],
				groups: [{ op: FilterGroupOp.Or, rules: [] }],
			}),
		).toBe(true);
	});

	it("describeGroup summarises count + the group's own join word", () => {
		expect(describeGroup({ op: FilterGroupOp.Or, rules: [rule("a", "1"), rule("b", "2")] })).toBe(
			"(2 rules · ANY)",
		);
		expect(describeGroup({ op: FilterGroupOp.And, rules: [rule("a", "1")] })).toBe("(1 rule · ALL)");
		expect(describeGroup({ op: FilterGroupOp.And, rules: [] })).toBe("(empty group)");
	});
});

describe("cross-property & clock refs (9.12.21)", () => {
	it("only comparison ops accept a reference", () => {
		for (const op of [
			FilterOp.Eq,
			FilterOp.Neq,
			FilterOp.Gt,
			FilterOp.Lt,
			FilterOp.Gte,
			FilterOp.Lte,
		]) {
			expect(opAcceptsRef(op)).toBe(true);
		}
		for (const op of [FilterOp.Contains, FilterOp.In, FilterOp.Exists]) {
			expect(opAcceptsRef(op)).toBe(false);
		}
	});

	it("maps compareTo:now / compareTo:prop to a PropertyRef and round-trips", () => {
		const nowRule = {
			propertyId: "due",
			op: FilterOp.Lt,
			value: "",
			compareTo: { kind: "now" as const },
		};
		expect(ruleToPredicate(nowRule)).toEqual({ $lt: { due: { $now: true } } });
		expect(
			filterNodeToDraft(draftToFilterNode({ op: FilterGroupOp.And, rules: [nowRule] })).rules,
		).toEqual([nowRule]);

		const propRule = {
			propertyId: "assignee",
			op: FilterOp.Eq,
			value: "",
			compareTo: { kind: "prop" as const, propertyId: "owner" },
		};
		expect(ruleToPredicate(propRule)).toEqual({ $eq: { assignee: { $prop: "owner" } } });
		expect(
			filterNodeToDraft(draftToFilterNode({ op: FilterGroupOp.And, rules: [propRule] })).rules,
		).toEqual([propRule]);
	});

	it("a prop ref with no target property is incomplete", () => {
		const bad = {
			propertyId: "a",
			op: FilterOp.Gt,
			value: "",
			compareTo: { kind: "prop" as const, propertyId: "" },
		};
		expect(isRuleComplete(bad)).toBe(false);
		expect(ruleToPredicate(bad)).toBeNull();
	});

	it("describes a ref rule with the referenced property / now (unquoted)", () => {
		expect(
			describeRule(
				{ propertyId: "due", op: FilterOp.Lt, value: "", compareTo: { kind: "now" } },
				"Due",
			),
		).toBe("Due less than now");
		expect(
			describeRule(
				{
					propertyId: "a",
					op: FilterOp.Eq,
					value: "",
					compareTo: { kind: "prop", propertyId: "owner" },
				},
				"Assignee",
				undefined,
				() => "Owner",
			),
		).toBe("Assignee is Owner");
	});
});

describe("negated group $not (9.12.21)", () => {
	it("wraps a negated group node and round-trips the flag", () => {
		const draft = {
			op: FilterGroupOp.And,
			rules: [{ propertyId: "status", op: FilterOp.Eq, value: "Done" }],
			negate: true,
		};
		const node = draftToFilterNode(draft);
		expect(node).toMatchObject({ kind: FilterNodeKind.Group, negate: true });
		expect(filterNodeToDraft(node).negate).toBe(true);
	});

	it("a non-negated group carries no negate flag", () => {
		const node = draftToFilterNode({
			op: FilterGroupOp.And,
			rules: [{ propertyId: "status", op: FilterOp.Eq, value: "Done" }],
		});
		expect(node && "negate" in node).toBe(false);
		expect(filterNodeToDraft(node).negate).toBeUndefined();
	});
});
