/**
 * Rich-text run transforms (9.17.12 rest) — the pure half of the inline
 * formatting toolbar. Every transform takes a run list + a `[start, end)`
 * range in plain-text offsets and returns a *new* normalized run list;
 * the DOM bridge (`render/rich-dom.ts`) owns offsets↔selection mapping.
 *
 * Normalization invariants (every public transform returns these):
 *   - no empty-text runs
 *   - no two adjacent runs with identical style (they merge)
 * Those keep the persisted shape canonical, so codec round-trips and
 * equality checks are byte-stable.
 */

import type { TextColor, TextSize } from "../types/node";
import { RichMark, type RichRun, isPlainRuns, runStyleEquals } from "../types/rich-text";

export function plainToRich(text: string): RichRun[] {
	return text === "" ? [] : [{ text }];
}

export function richToPlain(runs: readonly RichRun[]): string {
	let out = "";
	for (const run of runs) out += run.text;
	return out;
}

export function richTextLength(runs: readonly RichRun[]): number {
	let n = 0;
	for (const run of runs) n += run.text.length;
	return n;
}

/** Drop empty runs + merge adjacent equal-style runs. */
export function normalizeRuns(runs: readonly RichRun[]): RichRun[] {
	const out: RichRun[] = [];
	for (const run of runs) {
		if (run.text === "") continue;
		const last = out[out.length - 1];
		if (last && runStyleEquals(last, run)) {
			out[out.length - 1] = { ...last, text: last.text + run.text };
		} else {
			out.push({ ...run });
		}
	}
	return out;
}

/** Deep equality over normalized run lists (style + text). */
export function richRunsEqual(a: readonly RichRun[], b: readonly RichRun[]): boolean {
	const na = normalizeRuns(a);
	const nb = normalizeRuns(b);
	if (na.length !== nb.length) return false;
	for (let i = 0; i < na.length; i++) {
		const ra = na[i] as RichRun;
		const rb = nb[i] as RichRun;
		if (ra.text !== rb.text || !runStyleEquals(ra, rb)) return false;
	}
	return true;
}

/** The canonical persisted form: `null` when the runs add nothing over the
 *  plain mirror (so the node omits `rich`), else the normalized list. */
export function toPersistedRich(runs: readonly RichRun[]): RichRun[] | null {
	const normalized = normalizeRuns(runs);
	return normalized.length === 0 || isPlainRuns(normalized) ? null : normalized;
}

/** Map a style patch over the `[start, end)` slice, splitting runs at the
 *  boundaries; everything outside the range passes through. */
function mapRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
	patch: (run: RichRun) => RichRun,
): RichRun[] {
	const lo = Math.max(0, Math.min(start, end));
	const hi = Math.max(start, end);
	if (lo === hi) return normalizeRuns(runs);
	const out: RichRun[] = [];
	let pos = 0;
	for (const run of runs) {
		const runStart = pos;
		const runEnd = pos + run.text.length;
		pos = runEnd;
		if (runEnd <= lo || runStart >= hi) {
			out.push(run);
			continue;
		}
		const cutLo = Math.max(lo, runStart) - runStart;
		const cutHi = Math.min(hi, runEnd) - runStart;
		if (cutLo > 0) out.push({ ...run, text: run.text.slice(0, cutLo) });
		out.push(patch({ ...run, text: run.text.slice(cutLo, cutHi) }));
		if (cutHi < run.text.length) out.push({ ...run, text: run.text.slice(cutHi) });
	}
	return normalizeRuns(out);
}

const MARK_KEY: Readonly<Record<RichMark, "bold" | "italic" | "underline" | "strike">> = {
	[RichMark.Bold]: "bold",
	[RichMark.Italic]: "italic",
	[RichMark.Underline]: "underline",
	[RichMark.Strike]: "strike",
};

/** Set or clear `mark` over the range. */
export function applyMarkToRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
	mark: RichMark,
	on: boolean,
): RichRun[] {
	const key = MARK_KEY[mark];
	return mapRange(runs, start, end, (run) => {
		if (on) return { ...run, [key]: true };
		const { [key]: _cleared, ...rest } = run;
		return rest;
	});
}

/** True when every character in the non-empty range carries `mark`. */
export function rangeFullyMarked(
	runs: readonly RichRun[],
	start: number,
	end: number,
	mark: RichMark,
): boolean {
	const lo = Math.max(0, Math.min(start, end));
	const hi = Math.max(start, end);
	if (lo === hi) return false;
	const key = MARK_KEY[mark];
	let pos = 0;
	let covered = 0;
	for (const run of runs) {
		const runStart = pos;
		const runEnd = pos + run.text.length;
		pos = runEnd;
		const overlap = Math.min(hi, runEnd) - Math.max(lo, runStart);
		if (overlap <= 0) continue;
		if (run[key] !== true) return false;
		covered += overlap;
	}
	return covered >= hi - lo;
}

/** Toggle: fully-marked range clears the mark, anything else sets it
 *  (the familiar editor convention). */
export function toggleMarkInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
	mark: RichMark,
): RichRun[] {
	const on = !rangeFullyMarked(runs, start, end, mark);
	return applyMarkToRange(runs, start, end, mark, on);
}

/** Set (or clear with `null`) the per-run colour override over the range. */
export function setColorInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
	color: TextColor | null,
): RichRun[] {
	return mapRange(runs, start, end, (run) => {
		if (color === null) {
			const { color: _cleared, ...rest } = run;
			return rest;
		}
		return { ...run, color };
	});
}

/** Set (or clear with `null`) the per-run size override over the range. */
export function setSizeInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
	size: TextSize | null,
): RichRun[] {
	return mapRange(runs, start, end, (run) => {
		if (size === null) {
			const { size: _cleared, ...rest } = run;
			return rest;
		}
		return { ...run, size };
	});
}

/** The marks every character of the non-empty range carries — drives the
 *  toolbar buttons' pressed reflection. Empty range → empty set. */
export function marksInRange(runs: readonly RichRun[], start: number, end: number): Set<RichMark> {
	const out = new Set<RichMark>();
	for (const mark of Object.values(RichMark)) {
		if (rangeFullyMarked(runs, start, end, mark)) out.add(mark);
	}
	return out;
}

function uniformInRange<T>(
	runs: readonly RichRun[],
	start: number,
	end: number,
	read: (run: RichRun) => T | undefined,
): T | null {
	const lo = Math.max(0, Math.min(start, end));
	const hi = Math.max(start, end);
	if (lo === hi) return null;
	let pos = 0;
	let value: T | undefined;
	let seen = false;
	for (const run of runs) {
		const runStart = pos;
		const runEnd = pos + run.text.length;
		pos = runEnd;
		if (Math.min(hi, runEnd) - Math.max(lo, runStart) <= 0) continue;
		const v = read(run);
		if (v === undefined) return null;
		if (seen && v !== value) return null;
		value = v;
		seen = true;
	}
	return seen ? (value as T) : null;
}

/** The explicit colour every character of the range carries, or `null`
 *  (unset somewhere / mixed / empty range). */
export function uniformColorInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
): TextColor | null {
	return uniformInRange(runs, start, end, (run) => run.color);
}

/** The explicit size every character of the range carries, or `null`. */
export function uniformSizeInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
): TextSize | null {
	return uniformInRange(runs, start, end, (run) => run.size);
}

/** The selection-styling snapshot the formatting toolbar reflects. */
export type SelectionStyles = {
	marks: Set<RichMark>;
	color: TextColor | null;
	size: TextSize | null;
};

export function stylesInRange(
	runs: readonly RichRun[],
	start: number,
	end: number,
): SelectionStyles {
	return {
		marks: marksInRange(runs, start, end),
		color: uniformColorInRange(runs, start, end),
		size: uniformSizeInRange(runs, start, end),
	};
}
