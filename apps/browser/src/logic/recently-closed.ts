/**
 * Pure projection of a {@link BrowsingSession}'s recently-closed ring into the
 * "reopen closed tab" menu model. The chrome renders these through the shared
 * anchored-menu runtime and maps a selection back onto {@link
 * reopenClosedTabAt} via the carried `index`; the test drives the projection
 * directly. No DOM, no IPC, no clock — the reducer/menu split mirrors the rest
 * of `logic/`.
 */

import { type BrowsingSession, NEW_TAB_URL } from "../types/browsing-session";

/** One row in the recently-closed menu. `index` addresses the snapshot in
 *  {@link BrowsingSession.recentlyClosed} so the chrome reopens exactly that
 *  tab (not "the most recent"); `label` is the tab's display name. */
export type RecentlyClosedEntry = {
	readonly index: number;
	readonly label: string;
	readonly url: string;
};

export function hasRecentlyClosed(session: BrowsingSession): boolean {
	return session.recentlyClosed.length > 0;
}

/** Project the recently-closed ring to menu entries, most-recently-closed
 *  first (the ring stores oldest→newest, the menu reads newest→oldest like
 *  every browser's history list). The label falls back to the URL when the
 *  page never reported a title, and to a caller-supplied placeholder for a
 *  blank/new tab. */
export function recentlyClosedEntries(
	session: BrowsingSession,
	untitledLabel: string,
): readonly RecentlyClosedEntry[] {
	const entries: RecentlyClosedEntry[] = [];
	for (let index = session.recentlyClosed.length - 1; index >= 0; index -= 1) {
		const snap = session.recentlyClosed[index];
		if (!snap) continue;
		const url = snap.url === NEW_TAB_URL ? "" : snap.url.trim();
		const label = snap.title.trim() || url || untitledLabel;
		entries.push({ index, label, url: snap.url });
	}
	return entries;
}
