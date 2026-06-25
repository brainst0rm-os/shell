/**
 * Diff-view row model (9.7.7). Aligns the saved baseline against the current
 * buffer into a sequence of rows the diff view paints — unified (one column,
 * deletions then additions) or side-by-side (two columns, base | next).
 *
 * `diffLineStatuses` (logic/line-diff) marks the CURRENT buffer's lines for
 * the gutter, but a diff VIEW also has to show the DELETED base lines (which
 * no longer exist in `next`). So this walks the same LCS table and emits a
 * row per output line — including base-only deletions — carrying the text of
 * whichever side(s) the row touches plus its change kind. Pure (no DOM); the
 * `ui/diff-view.ts` renderer consumes the output.
 */

export enum DiffRowKind {
	/** Unchanged: present and identical on both sides. */
	Context = "context",
	/** Present only in `next` (a new line). */
	Added = "added",
	/** Present only in `base` (a removed line). */
	Removed = "removed",
}

export interface DiffRow {
	kind: DiffRowKind;
	/** 1-based line number in the baseline; `null` for an added row. */
	baseLine: number | null;
	/** 1-based line number in the current buffer; `null` for a removed row. */
	nextLine: number | null;
	/** The line text — from `base` for `Removed`, else from `next`. */
	text: string;
}

export interface DiffStats {
	added: number;
	removed: number;
}

function splitLines(text: string): string[] {
	return text.length === 0 ? [] : text.split("\n");
}

/** Bounds-safe table accessor (`noUncheckedIndexedAccess`). */
function at(dp: readonly number[][], i: number, j: number): number {
	return dp[i]?.[j] ?? 0;
}

/** Suffix-LCS table over two line arrays — same shape as line-diff's. */
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
 * Aligned diff rows for `base` → `next`. Walks the LCS so common lines are
 * `Context`, base-only lines are `Removed`, and next-only lines are `Added`.
 * Removals are emitted before the additions/context that follow them, the
 * conventional diff ordering (a "modified" line shows as a `Removed` then an
 * `Added` row, so both unified and side-by-side render correctly without a
 * separate modified kind).
 */
export function buildDiffRows(base: string, next: string): DiffRow[] {
	const a = splitLines(base);
	const b = splitLines(next);
	const dp = lcs(a, b);
	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			rows.push({ kind: DiffRowKind.Context, baseLine: i + 1, nextLine: j + 1, text: a[i] ?? "" });
			i++;
			j++;
			continue;
		}
		// Prefer emitting a removal first when the LCS gradient favours
		// advancing `base` (or `next` is exhausted) — keeps deletions above the
		// surviving line and pairs a modify as removed-then-added.
		if (i < a.length && (j >= b.length || at(dp, i + 1, j) >= at(dp, i, j + 1))) {
			rows.push({ kind: DiffRowKind.Removed, baseLine: i + 1, nextLine: null, text: a[i] ?? "" });
			i++;
		} else {
			rows.push({ kind: DiffRowKind.Added, baseLine: null, nextLine: j + 1, text: b[j] ?? "" });
			j++;
		}
	}
	return rows;
}

/** Added / removed line counts over a row sequence. */
export function diffStats(rows: readonly DiffRow[]): DiffStats {
	let added = 0;
	let removed = 0;
	for (const row of rows) {
		if (row.kind === DiffRowKind.Added) added++;
		else if (row.kind === DiffRowKind.Removed) removed++;
	}
	return { added, removed };
}

/** `true` iff there's any change between the two sides. */
export function hasDiff(rows: readonly DiffRow[]): boolean {
	return rows.some((row) => row.kind !== DiffRowKind.Context);
}
