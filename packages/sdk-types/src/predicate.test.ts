import { describe, expect, it } from "vitest";
import { FilterGroupOp, type FilterNode, FilterNodeKind, type PropertyPredicate } from "./index";
import * as predicate from "./predicate";

describe("predicate enums (wire format — values ARE the on-disk strings)", () => {
	it("FilterNodeKind maps to its persisted discriminator strings", () => {
		expect(FilterNodeKind.Predicate).toBe("predicate");
		expect(FilterNodeKind.Group).toBe("group");
	});

	it("FilterGroupOp maps to its persisted strings", () => {
		expect(FilterGroupOp.And).toBe("and");
		expect(FilterGroupOp.Or).toBe("or");
	});

	it("the barrel re-export is the same enum object as the leaf module", () => {
		expect(FilterNodeKind).toBe(predicate.FilterNodeKind);
		expect(FilterGroupOp).toBe(predicate.FilterGroupOp);
	});
});

describe("PropertyPredicate is the rich 9.3.5.1b superset (not the old 7-op subset)", () => {
	it("structurally accepts the operators the entities-repo compiler narrows", () => {
		const eq: PropertyPredicate = { $eq: { name: "x" } };
		const gt: PropertyPredicate = { $gt: { count: 3 } };
		const exists: PropertyPredicate = { $exists: { dueAt: true } };
		const and: PropertyPredicate = { $and: [eq, gt] };
		const or: PropertyPredicate = { $or: [eq, exists] };
		expect([eq, gt, exists, and, or]).toHaveLength(5);
	});

	it("adds the operators absent from the pre-9.3.5.1b inline subset", () => {
		const extra: PropertyPredicate[] = [
			{ $neq: { status: "done" } },
			{ $notContains: { tags: "draft" } },
			{ $gte: { score: 1 } },
			{ $lte: { score: 9 } },
			{ $in: { stage: ["a", "b"] } },
			{ $allIn: { labels: ["x", "y"] } },
			{ $notIn: { stage: ["z"] } },
			{ $empty: { note: true } },
			{ $like: { name: "fo%" } },
			{ $notLike: { name: "%bar" } },
			{ $not: { $eq: { archived: true } } },
		];
		expect(extra).toHaveLength(11);
	});
});

describe("FilterNode tree", () => {
	it("nests predicate + group nodes", () => {
		const tree: FilterNode = {
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { name: "x" } } },
				{
					kind: FilterNodeKind.Group,
					op: FilterGroupOp.Or,
					children: [{ kind: FilterNodeKind.Predicate, predicate: { $exists: { dueAt: true } } }],
				},
			],
		};
		expect(tree.kind).toBe("group");
		expect(tree.children).toHaveLength(2);
	});
});
