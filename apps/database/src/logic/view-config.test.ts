import { describe, expect, test } from "vitest";
import {
	EmptyPlacement,
	type FilterNode,
	FilterNodeKind,
	type ListView,
	ListViewKind,
	SortDirection,
	type TimelineLayoutOptions,
} from "../types";
import type { EntityRow } from "./in-memory-entities";
import { createView } from "./list-crud";
import { ViewConfigAction, applyViewConfig, defaultViewName, viewKindLabel } from "./view-config";

const baseView = (kind: ListViewKind = ListViewKind.Grid): ListView =>
	createView({ listId: "list-1", name: "All", kind, existingViewsForList: [] });

const row = (id: string, properties: Record<string, unknown>): EntityRow => ({
	id,
	type: "brainstorm/Object/v1",
	properties,
	createdAt: 0,
	updatedAt: 0,
	deletedAt: null,
});

describe("applyViewConfig", () => {
	test("SetColumns replaces only columns, returns a new reference", () => {
		const view = baseView();
		const cols = [{ propertyId: "fee", visible: true }];
		const next = applyViewConfig(view, { action: ViewConfigAction.SetColumns, columns: cols });
		expect(next).not.toBe(view);
		expect(next.columns).toBe(cols);
		expect(next.sorts).toBe(view.sorts);
		expect(next.kind).toBe(view.kind);
	});

	test("SetSorts replaces only sorts", () => {
		const view = baseView();
		const sorts = [
			{ propertyId: "fee", direction: SortDirection.Desc, emptyPlacement: EmptyPlacement.End },
		];
		const next = applyViewConfig(view, { action: ViewConfigAction.SetSorts, sorts });
		expect(next.sorts).toBe(sorts);
		expect(next.columns).toBe(view.columns);
	});

	test("SetFilters accepts a tree and accepts null (clear)", () => {
		const view = baseView();
		const filter: FilterNode = {
			kind: FilterNodeKind.Predicate,
			predicate: { $contains: { name: "x" } },
		};
		const withFilter = applyViewConfig(view, {
			action: ViewConfigAction.SetFilters,
			filters: filter,
		});
		expect(withFilter.filters).toBe(filter);
		const cleared = applyViewConfig(withFilter, {
			action: ViewConfigAction.SetFilters,
			filters: null,
		});
		expect(cleared.filters).toBeNull();
	});

	test("SetGroupBy sets and clears the axis", () => {
		const view = baseView();
		const grouped = applyViewConfig(view, {
			action: ViewConfigAction.SetGroupBy,
			groupBy: { propertyId: "status" },
		});
		expect(grouped.groupBy).toEqual({ propertyId: "status" });
		const cleared = applyViewConfig(grouped, {
			action: ViewConfigAction.SetGroupBy,
			groupBy: null,
		});
		expect(cleared.groupBy).toBeNull();
	});

	test("SetCardFields merges only the named card fields", () => {
		const view = baseView(ListViewKind.Gallery);
		const next = applyViewConfig(view, {
			action: ViewConfigAction.SetCardFields,
			fields: { coverProperty: "image" },
		});
		expect(next.coverProperty).toBe("image");
		expect(next.cardSubtitleProperty).toBe(view.cardSubtitleProperty);
		expect(next.columns).toBe(view.columns);
	});

	test("SetLayout replaces layoutOptions wholesale", () => {
		const view = baseView();
		const layout = { rowHeight: "compact", showRowNumbers: true, pinFirstColumn: false } as const;
		const next = applyViewConfig(view, {
			action: ViewConfigAction.SetLayout,
			layoutOptions: layout,
		});
		expect(next.layoutOptions).toBe(layout);
	});

	test("SetManualOrder stores the drag order", () => {
		const view = baseView();
		const next = applyViewConfig(view, {
			action: ViewConfigAction.SetManualOrder,
			order: ["c", "a", "b"],
		});
		expect(next.manualOrder).toEqual(["c", "a", "b"]);
	});

	describe("SetKind", () => {
		test("switching to the same kind is a no-op (same reference)", () => {
			const view = baseView(ListViewKind.Grid);
			const next = applyViewConfig(view, {
				action: ViewConfigAction.SetKind,
				kind: ListViewKind.Grid,
			});
			expect(next).toBe(view);
		});

		test("switching kind resets layout to that kind's default", () => {
			const view = baseView(ListViewKind.Grid);
			const next = applyViewConfig(view, {
				action: ViewConfigAction.SetKind,
				kind: ListViewKind.List,
			});
			expect(next.kind).toBe(ListViewKind.List);
			expect(next.layoutOptions).not.toEqual(view.layoutOptions);
		});

		test("switching to Board with no group-by auto-picks an axis from the rows", () => {
			const view = baseView(ListViewKind.Grid);
			const rows = [
				row("1", { status: "open" }),
				row("2", { status: "done" }),
				row("3", { status: "open" }),
			];
			const next = applyViewConfig(
				view,
				{ action: ViewConfigAction.SetKind, kind: ListViewKind.Board },
				rows,
			);
			expect(next.kind).toBe(ListViewKind.Board);
			expect(next.groupBy).toEqual({ propertyId: "status" });
		});

		test("switching to Calendar with no group-by auto-picks a date axis", () => {
			const view = baseView(ListViewKind.Grid);
			const rows = [row("1", { dueAt: 1_700_000_000_000 }), row("2", { dueAt: 1_700_100_000_000 })];
			const next = applyViewConfig(
				view,
				{ action: ViewConfigAction.SetKind, kind: ListViewKind.Calendar },
				rows,
			);
			expect(next.kind).toBe(ListViewKind.Calendar);
			expect(next.groupBy).toEqual({ propertyId: "dueAt" });
		});

		test("an existing group-by is preserved when switching to Board", () => {
			const grouped = applyViewConfig(baseView(ListViewKind.Grid), {
				action: ViewConfigAction.SetGroupBy,
				groupBy: { propertyId: "priority" },
			});
			const next = applyViewConfig(
				grouped,
				{ action: ViewConfigAction.SetKind, kind: ListViewKind.Board },
				[row("1", { status: "open" })],
			);
			expect(next.groupBy).toEqual({ propertyId: "priority" });
		});

		test("switching to a non-grouping kind never back-fills a group-by", () => {
			const view = baseView(ListViewKind.Grid);
			const next = applyViewConfig(
				view,
				{ action: ViewConfigAction.SetKind, kind: ListViewKind.Gallery },
				[row("1", { status: "open" })],
			);
			expect(next.kind).toBe(ListViewKind.Gallery);
			expect(next.groupBy).toBeNull();
		});

		test("Board switch with no usable axis in the rows leaves group-by null", () => {
			const view = baseView(ListViewKind.Grid);
			const next = applyViewConfig(
				view,
				{ action: ViewConfigAction.SetKind, kind: ListViewKind.Board },
				[],
			);
			expect(next.kind).toBe(ListViewKind.Board);
			expect(next.groupBy).toBeNull();
		});

		// F-211 — switching to Timeline must not land on "No items have a
		// value for dueDate" when the collection has an obvious date column.
		describe("Timeline date auto-bind (F-211)", () => {
			const timelineLayout = (view: ListView): TimelineLayoutOptions =>
				view.layoutOptions as TimelineLayoutOptions;

			test("binds the collection's single date property", () => {
				const rows = [
					row("1", { title: "Post A", publishAt: 1_700_000_000_000 }),
					row("2", { title: "Post B", publishAt: 1_700_100_000_000 }),
				];
				const next = applyViewConfig(
					baseView(ListViewKind.Grid),
					{ action: ViewConfigAction.SetKind, kind: ListViewKind.Timeline },
					rows,
				);
				expect(next.kind).toBe(ListViewKind.Timeline);
				expect(timelineLayout(next).primaryDateProperty).toBe("publishAt");
			});

			test("several date properties: the existing Calendar sibling's axis wins", () => {
				const rows = [row("1", { publishAt: 1_700_000_000_000, reviewAt: 1_700_050_000_000 })];
				const calendarSibling: ListView = {
					...createView({
						listId: "list-1",
						name: "Month",
						kind: ListViewKind.Calendar,
						existingViewsForList: [],
					}),
					groupBy: { propertyId: "reviewAt" },
				};
				const next = applyViewConfig(
					baseView(ListViewKind.Grid),
					{ action: ViewConfigAction.SetKind, kind: ListViewKind.Timeline },
					rows,
					[calendarSibling],
				);
				expect(timelineLayout(next).primaryDateProperty).toBe("reviewAt");
			});

			test("several date properties, no Calendar sibling: deterministic preference-rank pick", () => {
				const rows = [row("1", { publishAt: 1_700_000_000_000, dueAt: 1_700_050_000_000 })];
				const next = applyViewConfig(
					baseView(ListViewKind.Grid),
					{ action: ViewConfigAction.SetKind, kind: ListViewKind.Timeline },
					rows,
				);
				// `dueAt` is a known scheduling name; it outranks the inferred column.
				expect(timelineLayout(next).primaryDateProperty).toBe("dueAt");
			});

			test("a default binding that already carries values is kept", () => {
				const rows = [row("1", { dueDate: 1_700_000_000_000 })];
				const next = applyViewConfig(
					baseView(ListViewKind.Grid),
					{ action: ViewConfigAction.SetKind, kind: ListViewKind.Timeline },
					rows,
				);
				expect(timelineLayout(next).primaryDateProperty).toBe("dueDate");
			});

			test("no date property anywhere: the default binding is left alone", () => {
				const rows = [row("1", { status: "open" })];
				const next = applyViewConfig(
					baseView(ListViewKind.Grid),
					{ action: ViewConfigAction.SetKind, kind: ListViewKind.Timeline },
					rows,
				);
				expect(timelineLayout(next).primaryDateProperty).toBe("dueDate");
			});
		});
	});

	describe("SetName", () => {
		test("renames the view, returning a new reference", () => {
			const view = baseView();
			const next = applyViewConfig(view, {
				action: ViewConfigAction.SetName,
				name: "Editorial calendar",
			});
			expect(next).not.toBe(view);
			expect(next.name).toBe("Editorial calendar");
			expect(next.kind).toBe(view.kind);
			expect(next.columns).toBe(view.columns);
		});

		test("trims surrounding whitespace", () => {
			const next = applyViewConfig(baseView(), {
				action: ViewConfigAction.SetName,
				name: "  Pipeline  ",
			});
			expect(next.name).toBe("Pipeline");
		});

		test("the unchanged name is a no-op (same reference)", () => {
			const view = baseView();
			const next = applyViewConfig(view, { action: ViewConfigAction.SetName, name: view.name });
			expect(next).toBe(view);
		});

		test("an empty / whitespace-only name is a no-op (same reference)", () => {
			const view = baseView();
			expect(applyViewConfig(view, { action: ViewConfigAction.SetName, name: "" })).toBe(view);
			expect(applyViewConfig(view, { action: ViewConfigAction.SetName, name: "   " })).toBe(view);
		});
	});
});

describe("defaultViewName", () => {
	const named = (...names: string[]): Array<{ name: string }> => names.map((name) => ({ name }));

	test("a fresh list gets the bare kind label", () => {
		expect(defaultViewName(ListViewKind.Grid, [])).toBe("Grid");
		expect(defaultViewName(ListViewKind.Calendar, [])).toBe("Calendar");
		expect(defaultViewName(ListViewKind.Board, [])).toBe("Board");
	});

	test("collisions count up: Grid, Grid 2, Grid 3…", () => {
		expect(defaultViewName(ListViewKind.Grid, named("Grid"))).toBe("Grid 2");
		expect(defaultViewName(ListViewKind.Grid, named("Grid", "Grid 2"))).toBe("Grid 3");
	});

	test("counting skips a gap left by a user rename", () => {
		expect(defaultViewName(ListViewKind.Grid, named("Grid", "Grid 3"))).toBe("Grid 2");
	});

	test("other kinds' names don't collide with the new kind's label", () => {
		expect(defaultViewName(ListViewKind.Board, named("Grid", "Calendar"))).toBe("Board");
	});

	test("never the anonymous constant", () => {
		for (const kind of Object.values(ListViewKind)) {
			expect(viewKindLabel(kind)).not.toBe("New view");
			expect(defaultViewName(kind, [])).not.toBe("New view");
		}
	});
});
