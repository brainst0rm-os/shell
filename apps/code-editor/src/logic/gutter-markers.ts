/**
 * Gutter change markers (9.7.7 RENDER). Joins the 1-based line numbering
 * (`toCodeLines`) with the per-line diff status (`diffLineStatuses`) into a
 * single per-line descriptor the gutter renders: one number per line plus the
 * add/del/mod marker the surface paints against the saved baseline.
 *
 * Pure (no DOM) — the gutter view in `ui/code-pane.ts` consumes the output.
 */

import { toCodeLines } from "./code-view";
import { LineChange, diffLineStatuses } from "./line-diff";

export interface GutterLine {
	/** 1-based line number shown in the gutter. */
	number: number;
	/** Change status vs the saved baseline. */
	change: LineChange;
}

/**
 * One `GutterLine` per line of the CURRENT buffer (`content`), each carrying
 * its number and its change status against `baseline` (the last-saved file
 * content). When the buffer matches the baseline every line is `Unchanged`.
 *
 * The two pure cores stay independent: `toCodeLines` owns the empty-buffer
 * "one empty line" rule, `diffLineStatuses` owns the LCS. We align them by
 * index — both produce one entry per current line — and default any
 * status gap (e.g. the synthetic empty line) to `Unchanged`.
 */
export function gutterLines(baseline: string, content: string): GutterLine[] {
	const lines = toCodeLines(content);
	const statuses = diffLineStatuses(baseline, content);
	return lines.map((line, i) => ({
		number: line.number,
		change: statuses[i] ?? LineChange.Unchanged,
	}));
}
