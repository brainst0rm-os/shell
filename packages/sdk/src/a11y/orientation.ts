/**
 * Composite-keyboard orientation — vertical list, horizontal toolbar/tablist,
 * or 2-D grid. Enum, not bare string union, per the no-string-discriminator
 * convention.
 */
export enum Orientation {
	Vertical = "vertical",
	Horizontal = "horizontal",
	Grid = "grid",
	/** Sparse 2-D grid navigated by spatial nearest-in-direction (macOS Desktop
	 *  style), not dense row-major index math. Items carry `{col, row}` cells
	 *  passed to the reducer via `ctx.cells`; see `spatial-grid.ts`. */
	Spatial = "spatial",
}
