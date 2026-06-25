/**
 * Journal streaks + entry-density buckets (9.16.7) — pure, date-string based.
 *
 * Works entirely off the set of entry date keys (`YYYY-MM-DD`) + per-entry
 * word counts the projection already computes, so it's testable without the
 * store or the calendar widget. Day arithmetic parses the key as UTC midnight
 * and steps by whole days, which is DST-safe (no local-offset drift).
 */

/** The `YYYY-MM-DD` key one day before `key`. */
export function previousDateKey(key: string): string {
	const ms = Date.parse(`${key}T00:00:00Z`);
	const prev = new Date(ms - 86_400_000);
	return prev.toISOString().slice(0, 10);
}

/** Consecutive present days ending exactly at `fromKey` (inclusive). 0 when
 *  `fromKey` itself has no entry. */
function streakEndingAt(entryDateKeys: ReadonlySet<string>, fromKey: string): number {
	let count = 0;
	let cursor = fromKey;
	while (entryDateKeys.has(cursor)) {
		count += 1;
		cursor = previousDateKey(cursor);
	}
	return count;
}

/**
 * The live streak as of `todayKey`: the run of consecutive days with entries
 * ending today, or — if today has no entry yet — the still-extendable run
 * ending yesterday (so a streak you can save by writing today still shows).
 * 0 once two days in a row are missed.
 */
export function currentStreak(entryDateKeys: ReadonlySet<string>, todayKey: string): number {
	if (entryDateKeys.has(todayKey)) return streakEndingAt(entryDateKeys, todayKey);
	return streakEndingAt(entryDateKeys, previousDateKey(todayKey));
}

/**
 * The streak that will BREAK if today goes unwritten (9.16.11): the run of
 * consecutive days ending yesterday, but only while today itself has no
 * entry. 0 when today is already written (nothing at risk) or when there's
 * no run to lose. Drives the streak-break warning + the write-reminder copy.
 */
export function streakAtRisk(entryDateKeys: ReadonlySet<string>, todayKey: string): number {
	if (entryDateKeys.has(todayKey)) return 0;
	return streakEndingAt(entryDateKeys, previousDateKey(todayKey));
}

/** The longest consecutive-day run anywhere in the history. */
export function longestStreak(entryDateKeys: ReadonlySet<string>): number {
	let longest = 0;
	for (const key of entryDateKeys) {
		// Count a run only from its earliest day (the day before is absent), so
		// each run is measured once — O(n) overall, not O(n·len).
		if (entryDateKeys.has(previousDateKey(key))) continue;
		longest = Math.max(longest, streakEndingAtForward(entryDateKeys, key));
	}
	return longest;
}

function streakEndingAtForward(entryDateKeys: ReadonlySet<string>, startKey: string): number {
	let count = 0;
	let cursor = startKey;
	while (entryDateKeys.has(cursor)) {
		count += 1;
		cursor = nextDateKey(cursor);
	}
	return count;
}

function nextDateKey(key: string): string {
	const ms = Date.parse(`${key}T00:00:00Z`);
	const next = new Date(ms + 86_400_000);
	return next.toISOString().slice(0, 10);
}

/** Density bucket for a day's entry: 0 = none, 1 = brief (≤50 words),
 *  2 = medium (≤200), 3 = full (>200). Drives the calendar heatmap colour. */
export function densityBucket(wordCount: number): 0 | 1 | 2 | 3 {
	if (wordCount <= 0) return 0;
	if (wordCount <= 50) return 1;
	if (wordCount <= 200) return 2;
	return 3;
}
