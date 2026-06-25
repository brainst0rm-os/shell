/**
 * The one occurrence-materializer for the shared `Recurrence` union.
 *
 * Resolves OQ-CAL-2 / OQ-LD-15 / OQ-CT-3: a recurring thing (a Task
 * with `recurrence`, an `Event`, a Person birthday) is **never** a row
 * per occurrence — it is a single anchor + a `Recurrence`, projected
 * onto a visible window by this function. Calendar (events + birthdays),
 * the Database calendar view's seeded Birthdays view, and the Contacts
 * birthday surface all consume *this* — one model, one engine.
 *
 * Pure + leaf (imports only `./recurrence`). Local-time semantics: the
 * anchor's wall-clock time-of-day is preserved and calendar units step
 * via `Date` setters so DST transitions never accumulate drift (a
 * naive `+= 86_400_000` lands mid-day after a fall-back). The structured
 * kinds are fully expanded; `Custom { rrule }` is not parsed here (RFC
 * 5545 expansion is its own keystone) — it degrades to "just the anchor
 * if it's in range", so a custom-recurring item still shows its first
 * instance rather than vanishing.
 */

import {
	type MonthlyRecurrence,
	type Recurrence,
	RecurrenceKind,
	type Weekday,
	type WeeklyRecurrence,
	type YearlyRecurrence,
} from "./recurrence";

/** Hard ceiling so a pathological range can never spin the loop —
 *  callers pass a grid window (a month, a few weeks); thousands of
 *  daily occurrences already means the caller asked for the wrong
 *  thing. The list is truncated, not an error. */
export const MAX_OCCURRENCES = 1000;

export interface OccurrenceOptions {
	/** Lower the {@link MAX_OCCURRENCES} cap (never raise it). */
	maxOccurrences?: number;
}

function finite(n: unknown): n is number {
	return typeof n === "number" && Number.isFinite(n);
}

/** ISO weekday → JS `Date.getDay()` index (Sun=0). */
const WEEKDAY_TO_JS: Readonly<Record<Weekday, number>> = {
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
	sun: 0,
} as Readonly<Record<Weekday, number>>;

function atLocal(
	year: number,
	month0: number,
	day: number,
	h: number,
	mi: number,
	s: number,
	ms: number,
): number {
	return new Date(year, month0, day, h, mi, s, ms).getTime();
}

function daysInMonth(year: number, month0: number): number {
	return new Date(year, month0 + 1, 0).getDate();
}

/** nth weekday of a month (ordinal 1..4, or -1 = last). */
function nthWeekdayOfMonth(
	year: number,
	month0: number,
	jsWeekday: number,
	ordinal: number,
): number {
	if (ordinal === -1) {
		const last = daysInMonth(year, month0);
		for (let d = last; d >= 1; d--) {
			if (new Date(year, month0, d).getDay() === jsWeekday) return d;
		}
		return last;
	}
	let seen = 0;
	const len = daysInMonth(year, month0);
	for (let d = 1; d <= len; d++) {
		if (new Date(year, month0, d).getDay() === jsWeekday) {
			seen++;
			if (seen === ordinal) return d;
		}
	}
	return len;
}

type Clock = { h: number; mi: number; s: number; ms: number };

function clockOf(d: Date): Clock {
	return { h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), ms: d.getMilliseconds() };
}

function pushIfInRange(
	out: number[],
	ts: number,
	start: number,
	rangeStart: number,
	rangeEnd: number,
): void {
	if (ts >= start && ts >= rangeStart && ts <= rangeEnd) out.push(ts);
}

function dailyOccurrences(
	a: Date,
	clk: Clock,
	every: number,
	start: number,
	rangeStart: number,
	rangeEnd: number,
	cap: number,
): number[] {
	const out: number[] = [];
	// Fast-forward whole periods so a 1970 anchor with a 2026 window
	// doesn't iterate 20k times before the first hit.
	const dayGap = Math.floor((rangeStart - start) / 86_400_000);
	const skip = dayGap > 0 ? Math.floor(dayGap / every) * every : 0;
	const cursor = new Date(a);
	cursor.setDate(cursor.getDate() + skip);
	while (cursor.getTime() <= rangeEnd && out.length < cap) {
		pushIfInRange(out, cursor.getTime(), start, rangeStart, rangeEnd);
		cursor.setDate(cursor.getDate() + every);
		cursor.setHours(clk.h, clk.mi, clk.s, clk.ms);
	}
	return out;
}

function weeklyOccurrences(
	a: Date,
	clk: Clock,
	rec: WeeklyRecurrence,
	start: number,
	rangeStart: number,
	rangeEnd: number,
	cap: number,
): number[] {
	const out: number[] = [];
	const every = Math.max(1, Math.floor(rec.every));
	const targets = new Set<number>();
	for (const d of rec.days) {
		const js = WEEKDAY_TO_JS[d];
		if (js !== undefined) targets.add(js);
	}
	if (targets.size === 0) return out;
	// Anchor to the Monday of the start's week, step in `every`-week blocks.
	const weekStart = new Date(a);
	const sinceMon = (weekStart.getDay() + 6) % 7;
	weekStart.setDate(weekStart.getDate() - sinceMon);
	weekStart.setHours(0, 0, 0, 0);
	const weekGap = Math.floor((rangeStart - weekStart.getTime()) / (7 * 86_400_000));
	const skipWeeks = weekGap > 0 ? Math.floor(weekGap / every) * every : 0;
	const cursorWeek = new Date(weekStart);
	cursorWeek.setDate(cursorWeek.getDate() + skipWeeks * 7);
	while (cursorWeek.getTime() <= rangeEnd && out.length < cap) {
		for (let i = 0; i < 7 && out.length < cap; i++) {
			const day = new Date(cursorWeek);
			day.setDate(day.getDate() + i);
			if (!targets.has(day.getDay())) continue;
			const ts = atLocal(
				day.getFullYear(),
				day.getMonth(),
				day.getDate(),
				clk.h,
				clk.mi,
				clk.s,
				clk.ms,
			);
			pushIfInRange(out, ts, start, rangeStart, rangeEnd);
		}
		cursorWeek.setDate(cursorWeek.getDate() + every * 7);
	}
	out.sort((x, y) => x - y);
	return out;
}

function monthlyOccurrences(
	a: Date,
	clk: Clock,
	rec: MonthlyRecurrence,
	start: number,
	rangeStart: number,
	rangeEnd: number,
	cap: number,
): number[] {
	const out: number[] = [];
	const every = Math.max(1, Math.floor(rec.every));
	let year = a.getFullYear();
	let month0 = a.getMonth();
	// Fast-forward whole-month periods.
	const rs = new Date(rangeStart);
	const monthGap = (rs.getFullYear() - year) * 12 + (rs.getMonth() - month0);
	if (monthGap > 0) {
		const skip = Math.floor(monthGap / every) * every;
		month0 += skip;
		year += Math.floor(month0 / 12);
		month0 = ((month0 % 12) + 12) % 12;
	}
	let guard = 0;
	while (out.length < cap && guard < MAX_OCCURRENCES + 24) {
		guard++;
		let day: number;
		if (typeof rec.dayOfMonth === "number") {
			day = Math.min(rec.dayOfMonth, daysInMonth(year, month0));
		} else if (rec.dayOfWeek) {
			const js = WEEKDAY_TO_JS[rec.dayOfWeek.weekday];
			day = nthWeekdayOfMonth(year, month0, js ?? 1, rec.dayOfWeek.ordinal);
		} else {
			day = Math.min(a.getDate(), daysInMonth(year, month0));
		}
		const ts = atLocal(year, month0, day, clk.h, clk.mi, clk.s, clk.ms);
		if (ts > rangeEnd) break;
		pushIfInRange(out, ts, start, rangeStart, rangeEnd);
		month0 += every;
		year += Math.floor(month0 / 12);
		month0 = ((month0 % 12) + 12) % 12;
	}
	return out;
}

function yearlyOccurrences(
	clk: Clock,
	rec: YearlyRecurrence,
	start: number,
	rangeStart: number,
	rangeEnd: number,
	cap: number,
): number[] {
	const out: number[] = [];
	const month0 = Math.min(11, Math.max(0, rec.month - 1));
	let year = new Date(rangeStart).getFullYear() - 1;
	const endYear = new Date(rangeEnd).getFullYear() + 1;
	while (year <= endYear && out.length < cap) {
		// Short-month clamp (the canonical Feb-29 → Feb-28 in non-leap years).
		const day = Math.min(rec.day, daysInMonth(year, month0));
		const ts = atLocal(year, month0, day, clk.h, clk.mi, clk.s, clk.ms);
		pushIfInRange(out, ts, start, rangeStart, rangeEnd);
		year++;
	}
	return out;
}

/**
 * Every occurrence instant of `recurrence` (anchored at `start`, epoch
 * ms) that falls within `[rangeStart, rangeEnd]` inclusive, ascending.
 *
 * No occurrence is ever earlier than `start` (a recurrence has no
 * history before its anchor). The result is truncated at
 * `min(opts.maxOccurrences ?? MAX_OCCURRENCES, MAX_OCCURRENCES)`. A
 * non-finite input, an inverted range, or an unparseable shape yields
 * `[]` (or, for `Custom`, just the anchor if it's in range).
 */
export function occurrencesInRange(
	start: number,
	recurrence: Recurrence,
	rangeStart: number,
	rangeEnd: number,
	opts: OccurrenceOptions = {},
): number[] {
	if (!finite(start) || !finite(rangeStart) || !finite(rangeEnd)) return [];
	if (rangeStart > rangeEnd) return [];
	const cap = Math.max(
		1,
		Math.min(
			MAX_OCCURRENCES,
			finite(opts.maxOccurrences) ? Math.floor(opts.maxOccurrences) : MAX_OCCURRENCES,
		),
	);
	const a = new Date(start);
	const clk = clockOf(a);

	switch (recurrence.kind) {
		case RecurrenceKind.Daily: {
			const every = Math.max(1, Math.floor(recurrence.every));
			return dailyOccurrences(a, clk, every, start, rangeStart, rangeEnd, cap);
		}
		case RecurrenceKind.Weekly:
			return weeklyOccurrences(a, clk, recurrence, start, rangeStart, rangeEnd, cap);
		case RecurrenceKind.Monthly:
			return monthlyOccurrences(a, clk, recurrence, start, rangeStart, rangeEnd, cap);
		case RecurrenceKind.Yearly:
			return yearlyOccurrences(clk, recurrence, start, rangeStart, rangeEnd, cap);
		case RecurrenceKind.Custom: {
			// RRULE parsing is a separate keystone — degrade to the anchor
			// so a custom-recurring item still shows its first instance.
			const out: number[] = [];
			pushIfInRange(out, start, start, rangeStart, rangeEnd);
			return out;
		}
		default:
			return [];
	}
}

/**
 * The shared "a birthday is a yearly virtual occurrence" model
 * (OQ-CAL-2 / OQ-CT-3): derive the `YearlyRecurrence` from a stored
 * birthday/anniversary instant. Calendar, the Database Birthdays view,
 * and Contacts all build the recurrence this way so the day-of-year is
 * identical across surfaces. `null` for a non-finite anchor.
 */
export function yearlyRecurrenceForDate(anchorEpochMs: number): YearlyRecurrence | null {
	if (!finite(anchorEpochMs)) return null;
	const d = new Date(anchorEpochMs);
	return { kind: RecurrenceKind.Yearly, month: d.getMonth() + 1, day: d.getDate() };
}

/** Convenience: the yearly occurrences of a stored birthday within a
 *  window — the exact call Calendar/Database/Contacts make. Empty when
 *  the anchor is unusable. */
export function birthdayOccurrencesInRange(
	birthdayEpochMs: number,
	rangeStart: number,
	rangeEnd: number,
	opts: OccurrenceOptions = {},
): number[] {
	const rec = yearlyRecurrenceForDate(birthdayEpochMs);
	if (!rec) return [];
	return occurrencesInRange(birthdayEpochMs, rec, rangeStart, rangeEnd, opts);
}
