/**
 * Dashboard grid placement — the single source of "where does a new
 * pinned tile land". Extracted so the entity-pin path (dashboard-service)
 * and the shell-surface-pin path (Bin overlay) compute the first free
 * cell identically (DRY — previously inlined only in dashboard-service).
 *
 * Pure: same icon map → same cell. `GRID_COLS` mirrors the renderer's
 * fixed-width grid (`dashboard/grid.ts`).
 */

export const GRID_COLS = 12;

/** Integer-cell coordinates already occupied by an icon. Legacy pixel
 *  records (non-integer x/y, rare, renderer-migrated) occupy no cell —
 *  the renderer's collision layer handles any residual display overlap. */
export function occupiedCells(icons: Record<string, { x: number; y: number }>): Set<string> {
	const taken = new Set<string>();
	for (const icon of Object.values(icons)) {
		if (Number.isInteger(icon.x) && Number.isInteger(icon.y)) {
			taken.add(`${icon.x}:${icon.y}`);
		}
	}
	return taken;
}

/** First free `{col, row}` scanning row-major over the fixed-width grid. */
export function firstFreeCell(taken: ReadonlySet<string>): { col: number; row: number } {
	for (let row = 0; ; row++) {
		for (let col = 0; col < GRID_COLS; col++) {
			if (!taken.has(`${col}:${row}`)) return { col, row };
		}
	}
}
