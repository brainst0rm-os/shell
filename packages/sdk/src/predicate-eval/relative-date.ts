/**
 * Live-rolling relative-date ranges (9.12.20) — the pure resolver half.
 *
 * A "Last 7 days" filter should re-evaluate against the current clock every
 * time the view compiles, not snapshot to absolute millisecond bounds when the
 * user applies it (otherwise "Last 7 days" silently freezes to the week it was
 * set). This module maps a `RelativeDateRange` token + an injected `now` to a
 * concrete `[start, end)` millisecond window using local calendar time, and a
 * membership test over a raw cell value. The predicate-language token + the
 * filter-builder picker that carry this at evaluation time are the follow-up;
 * keeping the math pure here makes the calendar edges (month/year/DST, week
 * start) unit-testable without the view surface.
 */

export enum RelativeDateRange {
	Today = "today",
	Yesterday = "yesterday",
	Tomorrow = "tomorrow",
	Last7Days = "last7Days",
	Last30Days = "last30Days",
	Next7Days = "next7Days",
	Next30Days = "next30Days",
	ThisWeek = "thisWeek",
	ThisMonth = "thisMonth",
	ThisYear = "thisYear",
}

/** All relative ranges in picker order (Today-relative, then trailing, then
 *  leading, then this-period). The filter-builder picker iterates this. */
export const ALL_RELATIVE_DATE_RANGES: readonly RelativeDateRange[] = Object.freeze([
	RelativeDateRange.Today,
	RelativeDateRange.Yesterday,
	RelativeDateRange.Tomorrow,
	RelativeDateRange.Last7Days,
	RelativeDateRange.Last30Days,
	RelativeDateRange.Next7Days,
	RelativeDateRange.Next30Days,
	RelativeDateRange.ThisWeek,
	RelativeDateRange.ThisMonth,
	RelativeDateRange.ThisYear,
]);

/** Narrow an arbitrary string (e.g. a `$relativeDate` predicate token read off
 *  a persisted filter) to a known `RelativeDateRange`. An unknown token is not
 *  a range — the evaluator treats it as match-nothing rather than throwing. */
export function isRelativeDateRange(value: unknown): value is RelativeDateRange {
	return (
		typeof value === "string" && (ALL_RELATIVE_DATE_RANGES as readonly string[]).includes(value)
	);
}

const RELATIVE_RANGE_LABELS: Record<RelativeDateRange, string> = {
	[RelativeDateRange.Today]: "Today",
	[RelativeDateRange.Yesterday]: "Yesterday",
	[RelativeDateRange.Tomorrow]: "Tomorrow",
	[RelativeDateRange.Last7Days]: "Last 7 days",
	[RelativeDateRange.Last30Days]: "Last 30 days",
	[RelativeDateRange.Next7Days]: "Next 7 days",
	[RelativeDateRange.Next30Days]: "Next 30 days",
	[RelativeDateRange.ThisWeek]: "This week",
	[RelativeDateRange.ThisMonth]: "This month",
	[RelativeDateRange.ThisYear]: "This year",
};

/** Human label for a relative range — the filter picker option + the filter
 *  chip description. An unknown token (a forward-incompatible persisted filter)
 *  reads as the raw token rather than throwing. */
export function relativeRangeLabel(range: string): string {
	return isRelativeDateRange(range) ? RELATIVE_RANGE_LABELS[range] : range;
}

/** Half-open window: `start <= t < end`. */
export type DateWindow = { start: number; end: number };

/** Local midnight at the start of the day `now` falls in. */
function startOfDay(now: number): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Local midnight `offsetDays` from the start of `now`'s day (handles
 *  month/year/DST boundaries via the Date API rather than ms arithmetic). */
function dayStartOffset(now: number, offsetDays: number): number {
	const d = new Date(startOfDay(now));
	d.setDate(d.getDate() + offsetDays);
	return d.getTime();
}

/** Resolve a relative range to a concrete half-open `[start, end)` window
 *  against `now`. Week starts Monday (ISO). */
export function resolveRelativeRange(range: RelativeDateRange, now: number): DateWindow {
	const todayStart = startOfDay(now);
	const tomorrowStart = dayStartOffset(now, 1);
	switch (range) {
		case RelativeDateRange.Today:
			return { start: todayStart, end: tomorrowStart };
		case RelativeDateRange.Yesterday:
			return { start: dayStartOffset(now, -1), end: todayStart };
		case RelativeDateRange.Tomorrow:
			return { start: tomorrowStart, end: dayStartOffset(now, 2) };
		case RelativeDateRange.Last7Days:
			// The trailing 7 days INCLUDING today (today + 6 prior).
			return { start: dayStartOffset(now, -6), end: tomorrowStart };
		case RelativeDateRange.Last30Days:
			return { start: dayStartOffset(now, -29), end: tomorrowStart };
		case RelativeDateRange.Next7Days:
			// Today + the next 6 days.
			return { start: todayStart, end: dayStartOffset(now, 7) };
		case RelativeDateRange.Next30Days:
			return { start: todayStart, end: dayStartOffset(now, 30) };
		case RelativeDateRange.ThisWeek: {
			const d = new Date(todayStart);
			// getDay(): 0=Sun … 6=Sat. Shift so Monday is the week start.
			const weekday = (d.getDay() + 6) % 7;
			const start = dayStartOffset(now, -weekday);
			const end = new Date(start);
			end.setDate(end.getDate() + 7);
			return { start, end: end.getTime() };
		}
		case RelativeDateRange.ThisMonth: {
			const d = new Date(todayStart);
			const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
			const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
			return { start, end };
		}
		case RelativeDateRange.ThisYear: {
			const d = new Date(todayStart);
			const start = new Date(d.getFullYear(), 0, 1).getTime();
			const end = new Date(d.getFullYear() + 1, 0, 1).getTime();
			return { start, end };
		}
		default:
			return { start: todayStart, end: tomorrowStart };
	}
}

/** Coerce a raw cell value to a Unix-ms timestamp, or null. Accepts a ms
 *  number (timestamp window) or an ISO/parseable date string — same notion as
 *  the aggregation date coercion. */
export function toTimestamp(value: unknown): number | null {
	if (typeof value === "number") {
		return value >= 1_000_000_000_000 && value <= 4_000_000_000_000 ? value : null;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const t = Date.parse(value);
		return Number.isNaN(t) ? null : t;
	}
	return null;
}

/** True when `value` (a date cell) falls inside the relative range resolved
 *  against `now`. A non-date value is never in range. */
export function isInRelativeRange(value: unknown, range: RelativeDateRange, now: number): boolean {
	const t = toTimestamp(value);
	if (t === null) return false;
	const { start, end } = resolveRelativeRange(range, now);
	return t >= start && t < end;
}
