/**
 * Spawn-position resolution for newly-created nodes (F-199).
 *
 * Every create path (toolbar tool click, S/T/F chords, the Add ▾ menu)
 * funnels through `resolveSpawnPoint` so two rules hold board-wide:
 *
 *  1. the preferred point is honoured (the pointer's canvas position when
 *     the pointer is over the canvas, else the viewport centre — the
 *     caller decides which);
 *  2. a point already occupied by an existing node's origin cascades
 *     down-right in fixed steps until it lands on a free spot — repeated
 *     creates never stack pixel-identical copies on one spot (the dogfood
 *     vault accumulated 8 stickies at one point exactly this way).
 *
 * Pure: no DOM, no app state — unit-tested without the canvas.
 */

import type { CanvasPoint } from "./node-factory";

/** Down-right offset per cascade step — mirrors the duplicate-selection
 *  offset so "new on top of old" reads the same everywhere. */
export const SPAWN_CASCADE_STEP = 24;

/** Two origins closer than this (on both axes) count as "the same spot". */
export const SPAWN_OCCUPIED_EPSILON = 8;

/** Hard ceiling on cascade hops so a pathological board (thousands of
 *  cascaded nodes) can never loop unbounded; the step lands on the first
 *  free slot long before this in practice. */
const MAX_CASCADE_STEPS = 200;

export type SpawnObstacle = Readonly<{ x: number; y: number }>;

function isOccupied(
	candidate: CanvasPoint,
	obstacles: readonly SpawnObstacle[],
	epsilon: number,
): boolean {
	return obstacles.some(
		(o) => Math.abs(o.x - candidate.x) < epsilon && Math.abs(o.y - candidate.y) < epsilon,
	);
}

/** The first free spot at-or-cascaded-from `preferred`, given the origins
 *  of the nodes already on the board. */
export function resolveSpawnPoint(
	preferred: CanvasPoint,
	obstacles: readonly SpawnObstacle[],
	options: { step?: number; epsilon?: number } = {},
): CanvasPoint {
	const step = options.step ?? SPAWN_CASCADE_STEP;
	const epsilon = options.epsilon ?? SPAWN_OCCUPIED_EPSILON;
	let candidate: CanvasPoint = { x: preferred.x, y: preferred.y };
	for (let i = 0; i < MAX_CASCADE_STEPS && isOccupied(candidate, obstacles, epsilon); i++) {
		candidate = { x: candidate.x + step, y: candidate.y + step };
	}
	return candidate;
}
