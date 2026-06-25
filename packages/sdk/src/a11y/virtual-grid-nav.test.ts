import { describe, expect, it } from "vitest";
import {
	VirtualGridRowKind,
	type VirtualGridSection,
	buildVirtualGridModel,
} from "./virtual-grid-nav";

const section = (key: string, label: string | null, n: number): VirtualGridSection<string> => ({
	key,
	label,
	items: Array.from({ length: n }, (_, i) => `${key}-${i}`),
});

describe("buildVirtualGridModel", () => {
	it("flattens sections in order and chunks rows by cellsPerRow", () => {
		const model = buildVirtualGridModel([section("a", "A", 5), section("b", "B", 2)], 3);
		expect(model.items).toEqual(["a-0", "a-1", "a-2", "a-3", "a-4", "b-0", "b-1"]);
		expect(model.rows.map((r) => r.kind)).toEqual([
			VirtualGridRowKind.Header,
			VirtualGridRowKind.Cells,
			VirtualGridRowKind.Cells,
			VirtualGridRowKind.Header,
			VirtualGridRowKind.Cells,
		]);
	});

	it("stamps each cell row with the flat start index", () => {
		const model = buildVirtualGridModel([section("a", "A", 5), section("b", "B", 2)], 3);
		const cellRows = model.rows.filter((r) => r.kind === VirtualGridRowKind.Cells);
		expect(cellRows.map((r) => r.start)).toEqual([0, 3, 5]);
	});

	it("maps every item index to the row that renders it", () => {
		const model = buildVirtualGridModel([section("a", "A", 5), section("b", "B", 2)], 3);
		// rows: [header A, a row(0..2)=1, a row(3..4)=2, header B=3, b row(5..6)=4]
		expect(model.rowOfItem).toEqual([1, 1, 1, 2, 2, 4, 4]);
		expect(model.rowOfItem.length).toBe(model.items.length);
	});

	it("emits no header row for a null-label section (search results)", () => {
		const model = buildVirtualGridModel([section("results", null, 4)], 2);
		expect(model.rows.every((r) => r.kind === VirtualGridRowKind.Cells)).toBe(true);
		expect(model.rows.length).toBe(2);
	});

	it("skips the header of an empty section and survives cellsPerRow < 1", () => {
		const model = buildVirtualGridModel([section("a", "A", 0), section("b", "B", 2)], 0);
		// cellsPerRow clamps to 1 → one cell per row; empty section contributes nothing.
		expect(model.rows.map((r) => r.kind)).toEqual([
			VirtualGridRowKind.Header,
			VirtualGridRowKind.Cells,
			VirtualGridRowKind.Cells,
		]);
		expect(model.items).toEqual(["b-0", "b-1"]);
	});
});
