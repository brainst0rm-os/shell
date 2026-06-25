/**
 * Pure board-list view model for the left object-navigation sidebar
 * (B8.2). Kept out of `app.ts` so the filter/sort contract is unit
 * tested without mounting the DOM app.
 */

import type { Whiteboard } from "../types/whiteboard";

/** Boards matching `query` (case-insensitive substring of the name; an
 *  empty/whitespace query matches all), most-recently-updated first.
 *  Pure — never mutates the input array. */
export function filterAndSortBoards(boards: readonly Whiteboard[], query: string): Whiteboard[] {
	const q = query.trim().toLowerCase();
	return boards
		.filter((w) => q === "" || w.name.toLowerCase().includes(q))
		.slice()
		.sort((a, b) => b.updatedAt - a.updatedAt);
}
