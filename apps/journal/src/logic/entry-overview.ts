/**
 * Overview navigation (9.16.4-adjacent — 9.16.6): browse the whole
 * journal at a glance instead of stepping a day at a time.
 *
 * Pure grouping over the already-projected `JournalEntry[]`. The day grid
 * lives in the sidebar mini-calendar; this is the *list* axis — every
 * entry, newest first, bucketed by month — so the user can scan months of
 * writing and jump straight to any day. The `go-to-date` field (handled in
 * `app.ts`) reuses `parseJournalDateKey`; nothing date-mathy is duplicated
 * here.
 */

import type { JournalEntry } from "../types/entry";

export type JournalMonthSection = {
	/** `YYYY-MM` key for the month (calendar order key). */
	monthKey: string;
	/** Entries in the month, most-recent day first. */
	entries: JournalEntry[];
};

/** Group projected entries into month sections — newest month first, and
 *  newest day first within each. This is the browse order for the overview
 *  list (a journal is read most-recent-first). Entries are projection
 *  output, so every `dateKey` is a canonical `YYYY-MM-DD`. */
export function groupEntriesByMonth(entries: readonly JournalEntry[]): JournalMonthSection[] {
	const byMonth = new Map<string, JournalEntry[]>();
	for (const e of entries) {
		const monthKey = e.dateKey.slice(0, 7);
		const bucket = byMonth.get(monthKey);
		if (bucket) bucket.push(e);
		else byMonth.set(monthKey, [e]);
	}
	const sections: JournalMonthSection[] = [];
	for (const [monthKey, list] of byMonth) {
		list.sort((a, b) => b.dateEpochMs - a.dateEpochMs);
		sections.push({ monthKey, entries: list });
	}
	// Lexicographic compare on the zero-padded `YYYY-MM` key is calendar
	// order; reverse for newest-first.
	sections.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
	return sections;
}

/** Human month label for a `YYYY-MM` key, e.g. `"May 2026"`. Locale-aware;
 *  returns the raw key unchanged if it isn't a well-formed month key. */
export function monthLabelFromKey(monthKey: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
	if (!m) return monthKey;
	const year = Number(m[1]);
	const month = Number(m[2]);
	if (month < 1 || month > 12) return monthKey;
	return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});
}
