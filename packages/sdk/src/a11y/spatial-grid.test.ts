import { describe, expect, it } from "vitest";
import { type SpatialCell, SpatialDirection, spatialGridStep } from "./spatial-grid";

// A 3×3 block of cells at integer col/row, index = row*3 + col:
//   0(0,0) 1(1,0) 2(2,0)
//   3(0,1) 4(1,1) 5(2,1)
//   6(0,2) 7(1,2) 8(2,2)
const GRID3: SpatialCell[] = [
	{ col: 0, row: 0 },
	{ col: 1, row: 0 },
	{ col: 2, row: 0 },
	{ col: 0, row: 1 },
	{ col: 1, row: 1 },
	{ col: 2, row: 1 },
	{ col: 0, row: 2 },
	{ col: 1, row: 2 },
	{ col: 2, row: 2 },
];

describe("spatialGridStep", () => {
	it("moves to the adjacent aligned cell in each direction", () => {
		// From centre (index 4 = 1,1).
		expect(spatialGridStep(GRID3, 4, SpatialDirection.Right)).toBe(5);
		expect(spatialGridStep(GRID3, 4, SpatialDirection.Left)).toBe(3);
		expect(spatialGridStep(GRID3, 4, SpatialDirection.Down)).toBe(7);
		expect(spatialGridStep(GRID3, 4, SpatialDirection.Up)).toBe(1);
	});

	it("does not wrap at an edge — the cursor sits", () => {
		expect(spatialGridStep(GRID3, 2, SpatialDirection.Right)).toBe(2); // top-right, no further right
		expect(spatialGridStep(GRID3, 0, SpatialDirection.Up)).toBe(0); // top-left, no further up
		expect(spatialGridStep(GRID3, 6, SpatialDirection.Left)).toBe(6); // bottom-left
		expect(spatialGridStep(GRID3, 8, SpatialDirection.Down)).toBe(8); // bottom-right
	});

	it("favours the aligned cell over a nearer-but-skewed one", () => {
		// active at (0,0); to the right: an aligned cell far away (col 5, row 0)
		// vs a skewed cell nearer in column (col 1, row 4).
		const cells: SpatialCell[] = [
			{ col: 0, row: 0 }, // 0 active
			{ col: 5, row: 0 }, // 1 aligned, far (score 5)
			{ col: 1, row: 4 }, // 2 skewed (score 1 + 4*3 = 13)
		];
		expect(spatialGridStep(cells, 0, SpatialDirection.Right)).toBe(1);
	});

	it("picks the nearest in-direction cell across a gap (sparse grid)", () => {
		// Sparse: active (2,2); down-column has a cell at (2,5) and (2,9).
		const cells: SpatialCell[] = [
			{ col: 2, row: 2 }, // 0 active
			{ col: 2, row: 9 }, // 1 far
			{ col: 2, row: 5 }, // 2 nearer
		];
		expect(spatialGridStep(cells, 0, SpatialDirection.Down)).toBe(2);
	});

	it("is a no-op for an empty grid or an out-of-range active index", () => {
		expect(spatialGridStep([], 0, SpatialDirection.Right)).toBe(0);
		expect(spatialGridStep(GRID3, -1, SpatialDirection.Right)).toBe(-1);
		expect(spatialGridStep(GRID3, 99, SpatialDirection.Right)).toBe(99);
	});

	it("breaks ties deterministically by index", () => {
		// Two cells equally to the right + equally skewed → lower index wins.
		const cells: SpatialCell[] = [
			{ col: 0, row: 0 }, // 0 active
			{ col: 1, row: 1 }, // 1 score 1 + 1*3 = 4
			{ col: 1, row: -1 }, // 2 score 1 + 1*3 = 4 (also to the right)
		];
		expect(spatialGridStep(cells, 0, SpatialDirection.Right)).toBe(1);
	});
});
