/**
 * Tests for `compileView` — pins the filter / sort / group-by truth table
 * that every per-kind renderer relies on. Each renderer (grid / list /
 * gallery / board / calendar / timeline) reads the same `CompiledView`
 * shape, so failures here would surface uniformly across the whole app.
 */

import { describe, expect, it } from "vitest";
import {
	EmptyPlacement,
	FilterGroupOp,
	FilterNodeKind,
	type ListView,
	ListViewKind,
	SortDirection,
} from "../types";
import { applySorts, compileView, flattenFilter } from "./compile-view";
import type { EntityRow } from "./in-memory-entities";

function entity(id: string, properties: Record<string, unknown>): EntityRow {
	return {
		id,
		type: "io.test/Task/v1",
		properties,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function makeView(over: Partial<ListView>): ListView {
	return {
		id: "v",
		listId: "l",
		name: "v",
		icon: null,
		kind: ListViewKind.Grid,
		filters: null,
		sorts: [],
		groupBy: null,
		coverProperty: null,
		cardSubtitleProperty: null,
		columns: [],
		defaultTypeUrl: null,
		defaultTemplate: null,
		pageSize: 50,
		layoutOptions: { rowHeight: "comfortable", showRowNumbers: false, pinFirstColumn: true },
		...over,
	};
}

describe("flattenFilter", () => {
	it("returns null when the tree is empty", () => {
		expect(flattenFilter(null)).toBeNull();
	});

	it("unwraps a single-leaf predicate node", () => {
		expect(
			flattenFilter({
				kind: FilterNodeKind.Predicate,
				predicate: { $eq: { status: "Done" } },
			}),
		).toEqual({ $eq: { status: "Done" } });
	});

	it("collapses an AND group with one survivor into the survivor", () => {
		const out = flattenFilter({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } }],
		});
		expect(out).toEqual({ $eq: { status: "Done" } });
	});

	it("emits an $and wrapper for two-leaf AND groups", () => {
		const out = flattenFilter({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.And,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } },
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { priority: "High" } } },
			],
		});
		expect(out).toEqual({
			$and: [{ $eq: { status: "Done" } }, { $eq: { priority: "High" } }],
		});
	});

	it("emits an $or wrapper for two-leaf OR groups", () => {
		const out = flattenFilter({
			kind: FilterNodeKind.Group,
			op: FilterGroupOp.Or,
			children: [
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } },
				{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Open" } } },
			],
		});
		expect(out).toEqual({
			$or: [{ $eq: { status: "Done" } }, { $eq: { status: "Open" } }],
		});
	});

	it("wraps a negated group in $not (9.12.21)", () => {
		expect(
			flattenFilter({
				kind: FilterNodeKind.Group,
				op: FilterGroupOp.Or,
				negate: true,
				children: [
					{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } },
					{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Open" } } },
				],
			}),
		).toEqual({ $not: { $or: [{ $eq: { status: "Done" } }, { $eq: { status: "Open" } }] } });
	});

	it("negates a single-survivor group around the bare predicate", () => {
		expect(
			flattenFilter({
				kind: FilterNodeKind.Group,
				op: FilterGroupOp.And,
				negate: true,
				children: [{ kind: FilterNodeKind.Predicate, predicate: { $eq: { status: "Done" } } }],
			}),
		).toEqual({ $not: { $eq: { status: "Done" } } });
	});
});

describe("applySorts", () => {
	const rows = [
		entity("a", { priority: 3, name: "C" }),
		entity("b", { priority: 1, name: "A" }),
		entity("c", { priority: 2, name: "B" }),
	];

	it("sorts ascending by a numeric property", () => {
		const out = applySorts(rows, [
			{ propertyId: "priority", direction: SortDirection.Asc, emptyPlacement: EmptyPlacement.End },
		]);
		expect(out.map((r) => r.id)).toEqual(["b", "c", "a"]);
	});

	it("sorts descending", () => {
		const out = applySorts(rows, [
			{
				propertyId: "priority",
				direction: SortDirection.Desc,
				emptyPlacement: EmptyPlacement.End,
			},
		]);
		expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]);
	});

	it("places empties at the end when configured", () => {
		const data = [entity("a", {}), entity("b", { priority: 2 }), entity("c", { priority: 1 })];
		const out = applySorts(data, [
			{ propertyId: "priority", direction: SortDirection.Asc, emptyPlacement: EmptyPlacement.End },
		]);
		expect(out.map((r) => r.id)).toEqual(["c", "b", "a"]);
	});

	it("treats an empty array (e.g. no tags) as empty under emptyPlacement", () => {
		// A multi-value property with `[]` must sort with the other empties, not
		// as a present value (compile-view isEmpty parity with aggregations).
		const data = [entity("a", { tags: [] }), entity("b", { tags: ["x"] }), entity("c", {})];
		const out = applySorts(data, [
			{ propertyId: "tags", direction: SortDirection.Asc, emptyPlacement: EmptyPlacement.End },
		]);
		// Present value first; both empty kinds (`[]` and missing) trail.
		expect(out[0]?.id).toBe("b");
		expect(new Set([out[1]?.id, out[2]?.id])).toEqual(new Set(["a", "c"]));
	});

	it("returns a copy — does not mutate input", () => {
		const data = [entity("a", { priority: 3 }), entity("b", { priority: 1 })];
		const before = data.map((r) => r.id);
		applySorts(data, [
			{ propertyId: "priority", direction: SortDirection.Asc, emptyPlacement: EmptyPlacement.End },
		]);
		expect(data.map((r) => r.id)).toEqual(before);
	});
});

describe("compileView — groupBy", () => {
	it("buckets rows by the group-by property in first-seen order", () => {
		const data = [
			entity("a", { status: "Done" }),
			entity("b", { status: "Open" }),
			entity("c", { status: "Done" }),
			entity("d", {}),
		];
		const view = makeView({ groupBy: { propertyId: "status" } });
		const out = compileView(view, data);
		expect(out.groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
			["Done", ["a", "c"]],
			["Open", ["b"]],
			["Uncategorized", ["d"]],
		]);
	});

	it("orders lanes by the property's option order, not first-seen data order (F-037)", () => {
		// Rows reference stages in a non-funnel data order (Applied, Offer, Screen).
		const data = [
			entity("a", { stage: "applied" }),
			entity("b", { stage: "offer" }),
			entity("c", { stage: "screen" }),
			entity("d", {}),
		];
		const view = makeView({ groupBy: { propertyId: "stage" } });
		// Defined funnel order: Applied → Screen → Interview → Offer.
		const rank: Record<string, number> = { applied: 0, screen: 1, interview: 2, offer: 3 };
		const orderFor = (k: string) => rank[k];
		const out = compileView(view, data, undefined, orderFor);
		expect(out.groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
			["applied", ["a"]],
			["screen", ["c"]],
			["offer", ["b"]],
			[null, ["d"]], // Uncategorized stays last.
		]);
	});

	it("keeps first-seen order for group keys that have no option rank", () => {
		const data = [
			entity("a", { stage: "zeta" }),
			entity("b", { stage: "applied" }),
			entity("c", { stage: "qux" }),
		];
		const view = makeView({ groupBy: { propertyId: "stage" } });
		const orderFor = (k: string) => (k === "applied" ? 0 : undefined);
		const out = compileView(view, data, undefined, orderFor);
		// Ranked "applied" first; unranked keys keep their first-seen order.
		expect(out.groups.map((g) => g.key)).toEqual(["applied", "zeta", "qux"]);
	});

	it("resolves entity-id group keys to a label via labelFor (proj-0 → name)", () => {
		const data = [
			entity("t1", { projectId: "proj-0" }),
			entity("t2", { projectId: "proj-0" }),
			entity("t3", { projectId: "vocab-key" }),
		];
		const view = makeView({ groupBy: { propertyId: "projectId" } });
		const labelFor = (k: string) => (k === "proj-0" ? "Stage 0 — Foundations" : undefined);
		const out = compileView(view, data, labelFor);
		expect(out.groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
			["Stage 0 — Foundations", ["t1", "t2"]],
			// Unresolved keys fall back verbatim (vocabulary/string case).
			["vocab-key", ["t3"]],
		]);
	});

	it("does not group when groupBy is null", () => {
		const data = [entity("a", { status: "Done" })];
		const view = makeView({ groupBy: null });
		const out = compileView(view, data);
		expect(out.groups).toEqual([]);
		expect(out.rows.length).toBe(1);
	});

	it("applies the filter before grouping", () => {
		const data = [
			entity("a", { status: "Done" }),
			entity("b", { status: "Open" }),
			entity("c", { status: "Done" }),
		];
		const view = makeView({
			groupBy: { propertyId: "status" },
			filters: {
				kind: FilterNodeKind.Predicate,
				predicate: { $eq: { status: "Done" } },
			},
		});
		const out = compileView(view, data);
		expect(out.rows.map((r) => r.id)).toEqual(["a", "c"]);
		expect(out.groups).toHaveLength(1);
		expect(out.groups[0]?.label).toBe("Done");
	});
});
