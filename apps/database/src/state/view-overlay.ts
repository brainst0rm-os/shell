/**
 * View-override overlay — the bookkeeping that lets a vault `onChange`
 * rebuild keep the user's per-view tweaks (column reorder/resize, sort,
 * filter, kind, layout) alive across the destructive rebuild path.
 *
 * Used in two places by `app.ts`:
 *
 *   1. `schedulePersist`: after a user mutation, project every active
 *      `ListView` to its `ViewOverride` shape and store the map keyed by
 *      view id. This update is SYNCHRONOUS — the disk write is debounced,
 *      but a vault `onChange` rebuild may land before that debounce
 *      fires, so the in-memory overlay has to be current at the moment
 *      the user lets go of the drag.
 *
 *   2. `applyVaultSnapshot`: after `buildVaultLists` regenerates the
 *      vault-derived views from the fresh snapshot, re-attach the stored
 *      overlay onto each rebuilt view by id. Without this step the
 *      rebuild would silently revert the just-made reorder / sort /
 *      filter mid-session (the SH-38b–era symptom 9.12.R1's
 *      reproduce-first test guards against).
 *
 * Pure: no module state, no DOM, no IPC.
 */

import type { ListView } from "../types/list-view";

/** The user-tweakable subset of a `ListView`. A `null` value at a key
 *  means "no opinion — inherit from the vault-derived view"; the merge
 *  picks the overlay value only when present. */
export type ViewOverride = Partial<
	Pick<
		ListView,
		"name" | "kind" | "layoutOptions" | "columns" | "sorts" | "filters" | "groupBy" | "manualOrder"
	>
>;

/** Project a live `ListView` to its persistable overlay shape. Mirrors
 *  the historical `viewOverrideOf` in `app.ts:319`. */
export function viewOverrideOf(v: ListView): ViewOverride {
	const o: ViewOverride = {
		name: v.name,
		kind: v.kind,
		layoutOptions: v.layoutOptions,
		columns: v.columns,
		sorts: v.sorts,
		filters: v.filters,
		groupBy: v.groupBy,
	};
	if (v.manualOrder) o.manualOrder = v.manualOrder;
	return o;
}

/** Re-attach an overlay onto a freshly-rebuilt vault-derived view. Pure
 *  merge: overlay values win over the rebuilt view's defaults. Used by
 *  `applyVaultSnapshot` on every vault `onChange`. */
export function mergeOverlay(view: ListView, overlay: ViewOverride | undefined): ListView {
	if (!overlay) return view;
	return { ...view, ...overlay };
}
