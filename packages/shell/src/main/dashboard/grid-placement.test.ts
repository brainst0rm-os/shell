import { describe, expect, it } from "vitest";
import { GRID_COLS, firstFreeCell, occupiedCells } from "./grid-placement";

describe("occupiedCells", () => {
	it("collects only integer-cell records (legacy pixel records occupy nothing)", () => {
		const taken = occupiedCells({
			a: { x: 0, y: 0 },
			b: { x: 3, y: 1 },
			pixel: { x: 12.5, y: 40.2 }, // legacy float — ignored
		});
		expect([...taken].sort()).toEqual(["0:0", "3:1"]);
	});

	it("is empty for no icons", () => {
		expect(occupiedCells({}).size).toBe(0);
	});
});

describe("firstFreeCell", () => {
	it("returns 0:0 on an empty grid", () => {
		expect(firstFreeCell(new Set())).toEqual({ col: 0, row: 0 });
	});

	it("scans row-major, skipping taken cells", () => {
		expect(firstFreeCell(new Set(["0:0", "1:0"]))).toEqual({ col: 2, row: 0 });
	});

	it("wraps to the next row when the first is full", () => {
		const fullRow0 = new Set(Array.from({ length: GRID_COLS }, (_, c) => `${c}:0`));
		expect(firstFreeCell(fullRow0)).toEqual({ col: 0, row: 1 });
	});
});
