/**
 * Y.Doc ⇄ per-view node coordinates codec (9.13.6).
 *
 * Implements the persisted coordinate shape of `brainstorm/GraphView/v1`
 * per the resolved OQ-GR-2 (option (a) — layout is a property of the
 * rendering, so coordinates live on the *view*, never the entity):
 *
 *   - `coords` → a root `Y.Map<entityId, Y.Map>`; each node's map carries
 *     `x` / `y` (finite numbers, world coordinates) and `pinned` (boolean).
 *
 * One Y.Map **per node** so concurrent drags of *different* nodes on two
 * devices merge cleanly (structural merge), while concurrent drags of the
 * *same* node resolve per-field last-write-wins — the right call for a
 * coordinate, where a half-merged `{x: mine, y: theirs}` is no worse than
 * either endpoint and strictly better than clobbering the whole map.
 *
 * Encode is diff-aware inside a single `doc.transact`: unchanged fields are
 * not rewritten (no empty updates, no churn for observers), removed nodes
 * are deleted. Decode is tolerant — a malformed entry (non-finite numbers,
 * wrong types) is skipped rather than thrown, so a corrupt doc degrades to
 * "fewer restored positions", never a crash.
 */

import * as Y from "yjs";

/** Top-level Y.Doc field names on a `GraphView/v1` doc. */
export enum GraphViewDocField {
	Coords = "coords",
}

enum CoordField {
	X = "x",
	Y = "y",
	Pinned = "pinned",
}

export type NodeCoord = {
	x: number;
	y: number;
	pinned: boolean;
};

/** Per-view coordinate hard cap — matches the node cap in
 *  ` §Hard caps`. Enforced at write time:
 *  entries beyond the cap are dropped (the validator-side rejection lands
 *  with the entities-service write validation). */
export const MAX_VIEW_COORDS = 50_000;

/** Project `coords` onto `doc` (single transaction, diff-aware). Entries
 *  with non-finite numbers are skipped; nodes absent from `coords` are
 *  deleted from the doc. */
export function encodeCoordsIntoDoc(doc: Y.Doc, coords: ReadonlyMap<string, NodeCoord>): void {
	doc.transact(() => {
		const map = doc.getMap<Y.Map<unknown>>(GraphViewDocField.Coords);
		for (const key of [...map.keys()]) {
			if (!coords.has(key)) map.delete(key);
		}
		let written = 0;
		for (const [id, coord] of coords) {
			if (!Number.isFinite(coord.x) || !Number.isFinite(coord.y)) continue;
			if (written >= MAX_VIEW_COORDS) break;
			written += 1;
			let cmap = map.get(id);
			if (!(cmap instanceof Y.Map)) {
				cmap = new Y.Map<unknown>();
				map.set(id, cmap);
			}
			if (cmap.get(CoordField.X) !== coord.x) cmap.set(CoordField.X, coord.x);
			if (cmap.get(CoordField.Y) !== coord.y) cmap.set(CoordField.Y, coord.y);
			if (cmap.get(CoordField.Pinned) !== coord.pinned) cmap.set(CoordField.Pinned, coord.pinned);
		}
	});
}

/** Read the per-view coordinates from `doc`. Malformed entries are skipped. */
export function decodeCoordsFromDoc(doc: Y.Doc): Map<string, NodeCoord> {
	const out = new Map<string, NodeCoord>();
	const map = doc.getMap<Y.Map<unknown>>(GraphViewDocField.Coords);
	for (const [id, cmap] of map.entries()) {
		if (!(cmap instanceof Y.Map)) continue;
		const x = cmap.get(CoordField.X);
		const y = cmap.get(CoordField.Y);
		if (typeof x !== "number" || !Number.isFinite(x)) continue;
		if (typeof y !== "number" || !Number.isFinite(y)) continue;
		const pinned = cmap.get(CoordField.Pinned) === true;
		out.set(id, { x, y, pinned });
	}
	return out;
}
