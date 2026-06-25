/**
 * Spatial grid navigation — macOS-Desktop-style arrow movement across items
 * placed at arbitrary `{col, row}` cells (a *sparse* grid, unlike the dense
 * row-major `Orientation.Grid`). Pressing an arrow moves to the **nearest item
 * in that direction**, weighting the perpendicular offset so movement favours
 * staying aligned (an item directly adjacent wins over a closer-but-skewed one).
 * No wrap — at an edge the cursor sits, matching the macOS Desktop.
 *
 * Pure + exported so the geometry is unit-testable without a DOM; the
 * `Orientation.Spatial` branch of the composite reducer calls it.
 */

/** Cardinal move direction for spatial navigation. */
export enum SpatialDirection {
	Up = "up",
	Down = "down",
	Left = "left",
	Right = "right",
}

export type SpatialCell = { col: number; row: number };

// Perpendicular offset is multiplied by this before being added to the
// in-direction distance. >1 so a well-aligned item beats a nearer-but-skewed
// one (the "beam" preference real spatial-nav implementations use).
const PERPENDICULAR_WEIGHT = 3;

/**
 * Index of the item to move to from `activeIndex` in `direction`, or
 * `activeIndex` unchanged when there is no item that way (no wrap). Returns
 * `activeIndex` for an empty grid or an out-of-range active index.
 */
export function spatialGridStep(
	cells: ReadonlyArray<SpatialCell>,
	activeIndex: number,
	direction: SpatialDirection,
): number {
	if (activeIndex < 0 || activeIndex >= cells.length) return activeIndex;
	const from = cells[activeIndex];
	if (from === undefined) return activeIndex;

	let bestIndex = activeIndex;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let i = 0; i < cells.length; i++) {
		if (i === activeIndex) continue;
		const cell = cells[i];
		if (cell === undefined) continue;
		const dCol = cell.col - from.col;
		const dRow = cell.row - from.row;

		// Must lie strictly in the pressed direction along its primary axis.
		let primary: number;
		let perpendicular: number;
		switch (direction) {
			case SpatialDirection.Right:
				if (dCol <= 0) continue;
				primary = dCol;
				perpendicular = Math.abs(dRow);
				break;
			case SpatialDirection.Left:
				if (dCol >= 0) continue;
				primary = -dCol;
				perpendicular = Math.abs(dRow);
				break;
			case SpatialDirection.Down:
				if (dRow <= 0) continue;
				primary = dRow;
				perpendicular = Math.abs(dCol);
				break;
			case SpatialDirection.Up:
				if (dRow >= 0) continue;
				primary = -dRow;
				perpendicular = Math.abs(dCol);
				break;
		}

		const score = primary + perpendicular * PERPENDICULAR_WEIGHT;
		// Tie-break by raw index so the walk is deterministic.
		if (score < bestScore || (score === bestScore && i < bestIndex)) {
			bestScore = score;
			bestIndex = i;
		}
	}
	return bestIndex;
}
