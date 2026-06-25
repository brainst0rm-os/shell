/**
 * Event search (9.15.12) — keyword filter over the loaded scheduled
 * items. Pure: items + query in, ranked matches out. Recurrences are
 * expanded over a forward window so a match shows a concrete upcoming
 * date (one row per event — the occurrence nearest "now"); non-recurring
 * items always pass through with their real date.
 */

import { expandRecurringItems } from "./expand-recurring";
import type { ScheduledItem } from "./scheduled-item";

const DAY_MS = 86_400_000;

export type SearchOptions = {
	now: number;
	/** Past window (days before now) recurrences are expanded over. */
	pastDays?: number;
	/** Forward window (days after now). */
	futureDays?: number;
	/** Max results returned. */
	limit?: number;
};

/** Match score for an item against a lowercased query, or 0 for no match.
 *  Title-prefix beats title-substring beats a location/elsewhere hit. */
export function matchScore(item: ScheduledItem, query: string): number {
	const title = item.title.toLowerCase();
	if (title.startsWith(query)) return 3;
	if (title.includes(query)) return 2;
	const haystack = `${title} ${(item.location ?? "").toLowerCase()}`;
	if (haystack.includes(query)) return 1;
	return 0;
}

export function searchScheduledItems(
	items: readonly ScheduledItem[],
	query: string,
	opts: SearchOptions,
): ScheduledItem[] {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return [];

	const pastDays = opts.pastDays ?? 30;
	const futureDays = opts.futureDays ?? 365;
	const windowStart = opts.now - pastDays * DAY_MS;
	const windowEnd = opts.now + futureDays * DAY_MS;
	const expanded = expandRecurringItems(items, windowStart, windowEnd);

	// One row per source entity — keep the occurrence whose start is nearest
	// to "now", preferring upcoming ones.
	const bestByEntity = new Map<string, { item: ScheduledItem; score: number }>();
	for (const item of expanded) {
		const score = matchScore(item, q);
		if (score === 0) continue;
		const key = item.sourceEntityId;
		const existing = bestByEntity.get(key);
		if (!existing || closerToNow(item.start, existing.item.start, opts.now)) {
			bestByEntity.set(key, { item, score });
		}
	}

	const results = [...bestByEntity.values()];
	results.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return recencyRank(a.item.start, opts.now) - recencyRank(b.item.start, opts.now);
	});

	const limit = opts.limit ?? 50;
	return results.slice(0, limit).map((r) => r.item);
}

/** Upcoming occurrences sort ahead of past ones; within each, the nearest
 *  to `now` first. */
function recencyRank(start: number, now: number): number {
	const future = start >= now ? 0 : 1;
	return future * 1e15 + Math.abs(start - now);
}

function closerToNow(candidate: number, current: number, now: number): boolean {
	return recencyRank(candidate, now) < recencyRank(current, now);
}
