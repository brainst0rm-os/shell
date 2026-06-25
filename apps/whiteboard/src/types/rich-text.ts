/**
 * Rich-text runs for the text-bearing nodes (9.17.12 rest).
 *
 * A node body is a flat list of styled runs — plain JSON, no class
 * instances — so the model is Yjs-safe (it rides the board's JSON
 * persistence today and drops into a Y.Map value unchanged when the
 * board body migrates to a doc). `text` on the node stays the persisted
 * plain mirror (search / aria / export read it); `rich` is present only
 * when at least one run carries styling, so unstyled boards keep their
 * minimal on-disk shape and legacy rows need no migration.
 *
 * Run-level marks are *additive* over the node-level styling
 * (`bold` / `italic` / `textColor` / `textSize` on the node apply to the
 * whole body; a run override layers on top). There is no "unbold this
 * run inside a bold node" mark — that keeps the model monotone and the
 * codec trivial.
 */

import { TextColor, type TextSize, coerceTextColor, coerceTextSize } from "./node";

/** The boolean run marks. Wire values are the enum strings. */
export enum RichMark {
	Bold = "bold",
	Italic = "italic",
	Underline = "underline",
	Strike = "strike",
}

/** All marks in display order — frozen, safe to iterate. */
export const RICH_MARKS: readonly RichMark[] = Object.freeze([
	RichMark.Bold,
	RichMark.Italic,
	RichMark.Underline,
	RichMark.Strike,
]);

export type RichRun = {
	text: string;
	/** Boolean marks — present only when `true` (minimal on-disk shape). */
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** Per-run colour override; absent = the node-level / theme colour. */
	color?: TextColor;
	/** Per-run size override; absent = the node-level / default size. */
	size?: TextSize;
};

/** True when the run carries no styling at all. */
export function isPlainRun(run: RichRun): boolean {
	return (
		run.bold !== true &&
		run.italic !== true &&
		run.underline !== true &&
		run.strike !== true &&
		run.color === undefined &&
		run.size === undefined
	);
}

/** True when no run in the list carries styling — the rich form adds
 *  nothing over the plain `text` mirror and should be omitted on write. */
export function isPlainRuns(runs: readonly RichRun[]): boolean {
	return runs.every(isPlainRun);
}

/** Style equality ignoring `text` — drives adjacent-run merging. */
export function runStyleEquals(a: RichRun, b: RichRun): boolean {
	return (
		(a.bold === true) === (b.bold === true) &&
		(a.italic === true) === (b.italic === true) &&
		(a.underline === true) === (b.underline === true) &&
		(a.strike === true) === (b.strike === true) &&
		a.color === b.color &&
		a.size === b.size
	);
}

/**
 * Codec hardening (mirrors the node codec's drop-don't-crash contract): an
 * unknown value parses to a normalized run list or `null`. Bad runs drop;
 * bad mark/colour/size fields drop individually; an empty result is `null`
 * so callers fall back to the plain `text` mirror.
 */
export function coerceRichRuns(v: unknown): RichRun[] | null {
	if (!Array.isArray(v)) return null;
	const runs: RichRun[] = [];
	for (const raw of v) {
		if (!raw || typeof raw !== "object") continue;
		const r = raw as Record<string, unknown>;
		if (typeof r.text !== "string" || r.text === "") continue;
		const run: RichRun = { text: r.text };
		if (r.bold === true) run.bold = true;
		if (r.italic === true) run.italic = true;
		if (r.underline === true) run.underline = true;
		if (r.strike === true) run.strike = true;
		// `TextColor.Default` means "no override" — a run never stores it.
		const color = coerceTextColor(r.color);
		if (color && color !== TextColor.Default) run.color = color;
		const size = coerceTextSize(r.size);
		if (size) run.size = size;
		runs.push(run);
	}
	return runs.length > 0 ? runs : null;
}
