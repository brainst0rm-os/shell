/**
 * Cross-day entry search (9.16.9) — full-text-ish ranking + mood/habit
 * filters across ALL journal entries. The in-document find (B9.3) searches
 * only the focused day; this searches every entry and jumps to the day a
 * result lives on.
 *
 * Pure: entries + query + filters in, ranked results out. The haystack is
 * each entry's title + denormalised preview snippet (`note.body` after a
 * save is the clipped snippet, so deep-body FTS over the Y.Doc would need a
 * per-doc load — a later concern; the snippet covers the lead of every
 * entry). Multi-term queries are AND-matched; a title hit outscores a body
 * hit so date-key searches (`2026-05`) surface the right month first.
 */

import type { JournalEntry } from "../types/entry";
import type { HabitId, MoodId } from "./check-in";

export type EntrySearchFilters = {
	mood: MoodId | null;
	habits: HabitId[];
};

export type JournalSearchResult = {
	entry: JournalEntry;
	score: number;
	/** Context excerpt around the first matched term (or the preview lead
	 *  when only filters are active). */
	excerpt: string;
};

export const EMPTY_ENTRY_FILTERS: EntrySearchFilters = Object.freeze({ mood: null, habits: [] });

/** Whether the user has narrowed the result set at all — drives the
 *  overlay's "type to search" hint vs showing results. */
export function hasActiveSearch(query: string, filters: EntrySearchFilters): boolean {
	return query.trim().length > 0 || filters.mood !== null || filters.habits.length > 0;
}

export function searchEntries(
	entries: readonly JournalEntry[],
	query: string,
	filters: EntrySearchFilters = EMPTY_ENTRY_FILTERS,
): JournalSearchResult[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const results: JournalSearchResult[] = [];
	for (const entry of entries) {
		if (filters.mood !== null && entry.mood !== filters.mood) continue;
		if (filters.habits.length > 0 && !filters.habits.every((h) => entry.habits.includes(h))) {
			continue;
		}
		const title = entry.rawTitle.toLowerCase();
		const preview = entry.preview.toLowerCase();
		let score = 0;
		let matchedAll = true;
		for (const term of terms) {
			const inTitle = title.includes(term);
			const inPreview = preview.includes(term);
			if (!inTitle && !inPreview) {
				matchedAll = false;
				break;
			}
			if (inTitle) score += 2;
			if (inPreview) score += 1;
		}
		if (!matchedAll) continue;
		results.push({ entry, score, excerpt: buildExcerpt(entry.preview, terms) });
	}
	results.sort((a, b) => b.score - a.score || b.entry.dateEpochMs - a.entry.dateEpochMs);
	return results;
}

const EXCERPT_RADIUS = 48;

/** A short context window around the first matched term, with ellipses
 *  when clipped. With no terms (filter-only search) returns the preview
 *  lead unchanged. */
export function buildExcerpt(preview: string, terms: readonly string[]): string {
	if (terms.length === 0 || preview.length === 0) return preview;
	const lower = preview.toLowerCase();
	let first = -1;
	for (const term of terms) {
		const idx = lower.indexOf(term);
		if (idx >= 0 && (first < 0 || idx < first)) first = idx;
	}
	if (first < 0) return preview;
	const start = Math.max(0, first - EXCERPT_RADIUS);
	const end = Math.min(preview.length, first + EXCERPT_RADIUS);
	let out = preview.slice(start, end).trim();
	if (start > 0) out = `…${out}`;
	if (end < preview.length) out = `${out}…`;
	return out;
}
