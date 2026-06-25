/**
 * Proves the view-type switcher: changeViewKind swaps kind + resets
 * kind-specific layout, but preserves identity / filters / sorts /
 * columns / manualOrder, and is a no-op for the same kind.
 */

import { describe, expect, it } from "vitest";
import { changeViewKind, createView } from "../src/logic/list-crud";
import { ListViewKind } from "../src/types/list-view";

const grid = () => {
	const v = createView({ listId: "L", name: "V", existingViewsForList: [] });
	return {
		...v,
		columns: [{ propertyId: "name", visible: true }],
		sorts: [],
		manualOrder: ["a", "b"],
	};
};

describe("changeViewKind", () => {
	it("switches kind and resets layoutOptions to the new kind's defaults", () => {
		const board = changeViewKind(grid(), ListViewKind.Board);
		expect(board.kind).toBe(ListViewKind.Board);
		// Board layout shape differs from grid's rowHeight-based one.
		expect(board.layoutOptions).not.toHaveProperty("rowHeight");
	});

	it("preserves identity, columns, and manual order", () => {
		const src = grid();
		const cal = changeViewKind(src, ListViewKind.Calendar);
		expect(cal.id).toBe(src.id);
		expect(cal.name).toBe(src.name);
		expect(cal.columns).toEqual(src.columns);
		expect(cal.manualOrder).toEqual(["a", "b"]);
	});

	it("is a no-op (same reference) when the kind is unchanged", () => {
		const src = grid();
		expect(changeViewKind(src, ListViewKind.Grid)).toBe(src);
	});
});
