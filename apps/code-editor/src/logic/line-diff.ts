/**
 * Line-level change markers (9.7.7). Diffs the live buffer against the
 * last-persisted content so the gutter can flag which lines are
 * added / modified vs the saved file — the "unsaved changes" markers an
 * editor shows in its gutter. A standard LCS line diff; pure (no DOM).
 *
 * The full unified / side-by-side diff VIEW is a follow-on; this is the
 * change-marker substrate the gutter consumes.
 */

export enum LineChange {
	Unchanged = "unchanged",
	Added = "added",
	Modified = "modified",
	/** An unchanged line that sits immediately after one or more deleted
	 *  lines — the gutter draws a deletion caret on its top edge. */
	DeletedBefore = "deleted-before",
}

function splitLines(text: string): string[] {
	return text.length === 0 ? [] : text.split("\n");
}

/** Suffix-LCS length at `(i, j)` — read through a bounds-safe accessor so
 *  the table needs no non-null assertions (`noUncheckedIndexedAccess`). */
function at(dp: readonly number[][], i: number, j: number): number {
	return dp[i]?.[j] ?? 0;
}

/** Longest-common-subsequence table over two line arrays. */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		const row = dp[i] ?? [];
		for (let j = n - 1; j >= 0; j--) {
			row[j] = a[i] === b[j] ? at(dp, i + 1, j + 1) + 1 : Math.max(at(dp, i + 1, j), at(dp, i, j + 1));
		}
	}
	return dp;
}

/**
 * Per-line change status for the CURRENT buffer (`next`) against the
 * baseline (`base`). Returns one entry per line of `next` (0-based index
 * aligned to the current buffer). A run of base-only lines (a deletion)
 * marks the following surviving `next` line `DeletedBefore`; a deletion at
 * end-of-file marks the last line.
 *
 * "Modified" is inferred: an added `next` line adjacent to a deleted `base`
 * line reads as a modification (the common editor heuristic) rather than a
 * separate add+delete.
 */
export function diffLineStatuses(base: string, next: string): LineChange[] {
	const a = splitLines(base);
	const b = splitLines(next);
	const statuses: LineChange[] = new Array(b.length).fill(LineChange.Unchanged);
	if (b.length === 0) return statuses;
	const dp = lcs(a, b);
	let i = 0;
	let j = 0;
	let pendingDeletion = false;
	while (j < b.length) {
		if (i < a.length && a[i] === b[j]) {
			if (pendingDeletion) {
				statuses[j] = LineChange.DeletedBefore;
				pendingDeletion = false;
			}
			i++;
			j++;
			continue;
		}
		// Not a common line. Decide add vs delete by the LCS gradient.
		if (i < a.length && (j >= b.length || at(dp, i + 1, j) >= at(dp, i, j + 1))) {
			// `base` line deleted — defer the marker to the next surviving line.
			pendingDeletion = true;
			i++;
		} else {
			// `next` line added — modified if it consumed a deletion, else added.
			statuses[j] = pendingDeletion ? LineChange.Modified : LineChange.Added;
			pendingDeletion = false;
			j++;
		}
	}
	// A trailing deletion — lines removed at EOF (loop ended with `next`
	// exhausted while `base` lines remain) — marks the final line.
	if ((pendingDeletion || i < a.length) && statuses.length > 0) {
		const last = statuses.length - 1;
		if (statuses[last] === LineChange.Unchanged) statuses[last] = LineChange.DeletedBefore;
	}
	return statuses;
}

/** `true` iff the buffer differs from the baseline at all. */
export function hasLineChanges(base: string, next: string): boolean {
	return base !== next;
}
