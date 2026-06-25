/**
 * Bulk-selection helpers for the multi-select action bar (9.8.12).
 *
 * The selection is a `Set` (no inherent order); a bulk op should act in the
 * order the user *sees* the items, so the resulting selection (after a
 * duplicate, say) reads top-to-bottom rather than hash order. Pure +
 * render-free so the ordering is unit-tested without the store.
 */

/** The selected ids, in visible (sorted/filtered) order. Ids that aren't in
 *  the current visible set are dropped (they can't be acted on from the bar). */
export function orderedSelection(
	selected: ReadonlySet<string>,
	visibleIds: readonly string[],
): string[] {
	return visibleIds.filter((id) => selected.has(id));
}
