/**
 * Pure calendar-grid math — one canonical set of helpers used by every
 * app with a month/week date axis (Calendar app, Database calendar view,
 * Journal month-grid sidebar, Tasks date popovers, …).
 *
 * Third-copy promotion per [[feedback_extract_to_sdk_at_copy_two]]:
 * Calendar shipped `apps/calendar/src/logic/date-range.ts`, Journal
 * shipped `apps/journal/src/logic/calendar-grid.ts`, Database inlined
 * its own equivalents — three implementations of the same DST-aware
 * start-of-week / start-of-month / 6×7 grid math.
 *
 * Epoch-ms-first: every input + output is `number` (ms since epoch in
 * the host's local time zone). DST-safe via `Date.setDate(d.getDate() + n)`
 * rather than naive `+ DAY_MS` shifts. Date keys are `YYYY-MM-DD` in
 * local tz — same shape Tasks / Journal / Calendar already used so the
 * cross-app join shape is unchanged.
 */

export const DAY_MS = 86_400_000;

/** Numeric weekday for the user's preferred first day of week (mirrors
 *  `Date.prototype.getDay()` — 0 = Sunday … 6 = Saturday). Stored as a
 *  number so a JSON-Schema validator can validate inline; matches the
 *  per-app enums Calendar + Journal already used. */
export enum WeekStartsOn {
	Sunday = 0,
	Monday = 1,
	Saturday = 6,
}

/** A single cell in a Week / Month grid. Pre-computed so the renderer
 *  never has to test for null or do its own `inMonth` math. */
export type GridCell = {
	/** Local-day epoch ms at 00:00 — the cell's anchor. */
	dateEpochMs: number;
	/** `YYYY-MM-DD` in local tz — stable key for joining with vault data. */
	dateKey: string;
	/** 1–31 day-of-month for the displayed grid (NOT necessarily of the
	 *  focus month — leading/trailing-edge cells carry their own month's
	 *  day-of-month). */
	dayOfMonth: number;
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
	/** True when the cell is the day containing `now`. */
	isToday: boolean;
	/** True for cells inside the focus month. False for the leading/
	 *  trailing edges of a month grid (always populated so the grid stays
	 *  rectangular). For week grids: true for every cell. */
	inMonth: boolean;
	/** True for Saturday + Sunday. */
	isWeekend: boolean;
};

/* ── primitive math ───────────────────────────────────────────────── */

/** Epoch ms at 00:00:00.000 local on the day containing `epochMs`. */
export function startOfDay(epochMs: number): number {
	const d = new Date(epochMs);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Epoch ms at 23:59:59.999 local on the day containing `epochMs`. */
export function endOfDay(epochMs: number): number {
	const d = new Date(epochMs);
	d.setHours(23, 59, 59, 999);
	return d.getTime();
}

/** Add `days` calendar days to `epochMs`, surviving DST transitions (a
 *  `+ DAY_MS` shift would land mid-day after a fall-back). */
export function addDays(epochMs: number, days: number): number {
	const d = new Date(epochMs);
	d.setDate(d.getDate() + days);
	return d.getTime();
}

/** Add `months` calendar months to `epochMs`, clamping the day if the
 *  target month is shorter (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(epochMs: number, months: number): number {
	const d = new Date(epochMs);
	const day = d.getDate();
	d.setDate(1);
	d.setMonth(d.getMonth() + months);
	const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, lastDayOfTarget));
	return d.getTime();
}

/** Calendar-day delta between two anchors (signed, positive when `b`
 *  is after `a`). Ignores intra-day time. */
export function daysBetween(a: number, b: number): number {
	return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/** Epoch ms at the first instant of the month containing `epochMs`. */
export function startOfMonth(epochMs: number): number {
	const d = new Date(epochMs);
	d.setDate(1);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Epoch ms at the last instant of the month containing `epochMs`. */
export function endOfMonth(epochMs: number): number {
	const d = new Date(epochMs);
	d.setMonth(d.getMonth() + 1, 0);
	d.setHours(23, 59, 59, 999);
	return d.getTime();
}

/** Epoch ms at the start of the week containing `epochMs` for the given
 *  week-start preference. */
export function startOfWeek(epochMs: number, weekStartsOn: WeekStartsOn): number {
	const dayStart = startOfDay(epochMs);
	const dow = new Date(dayStart).getDay();
	const wantedDow = (weekStartsOn as number) % 7;
	const offset = (dow - wantedDow + 7) % 7;
	return addDays(dayStart, -offset);
}

/** Epoch ms at the end of the week containing `epochMs`. */
export function endOfWeek(epochMs: number, weekStartsOn: WeekStartsOn): number {
	return endOfDay(addDays(startOfWeek(epochMs, weekStartsOn), 6));
}

/** First date the Month view's 6×7 grid renders — start of the week
 *  containing the first of the month. */
export function startOfMonthGrid(epochMs: number, weekStartsOn: WeekStartsOn): number {
	return startOfWeek(startOfMonth(epochMs), weekStartsOn);
}

/** Last date the Month view's 6×7 grid renders. The grid is always 42
 *  cells (6 weeks × 7 days) so the chrome stays a fixed size — months
 *  that fit in 4 weeks still paint blank cells from the adjacent month,
 *  never jumpy reflow. */
export function endOfMonthGrid(epochMs: number, weekStartsOn: WeekStartsOn): number {
	return endOfDay(addDays(startOfMonthGrid(epochMs, weekStartsOn), 41));
}

/** 42 epoch-ms anchors (one per day of the month grid, all at start-of-
 *  day). Ordered chronologically. */
export function monthGridDays(epochMs: number, weekStartsOn: WeekStartsOn): number[] {
	const start = startOfMonthGrid(epochMs, weekStartsOn);
	const out: number[] = new Array(42);
	for (let i = 0; i < 42; i += 1) out[i] = addDays(start, i);
	return out;
}

/** 7 epoch-ms anchors for the week containing `epochMs`, at start-of-day. */
export function weekDays(epochMs: number, weekStartsOn: WeekStartsOn): number[] {
	const start = startOfWeek(epochMs, weekStartsOn);
	const out: number[] = new Array(7);
	for (let i = 0; i < 7; i += 1) out[i] = addDays(start, i);
	return out;
}

/** Stable date key (`YYYY-MM-DD` in local tz). Cross-app join shape. */
export function dateKey(epochMs: number): string {
	const d = new Date(epochMs);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** True when both anchors fall on the same local day. */
export function isSameDay(a: number, b: number): boolean {
	return dateKey(a) === dateKey(b);
}

/** True when both anchors fall in the same local month/year. */
export function isSameMonth(a: number, b: number): boolean {
	const A = new Date(a);
	const B = new Date(b);
	return A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth();
}

/* ── grid + label builders ────────────────────────────────────────── */

/** 7 cells starting on `weekStartsOn`, anchored on whatever week
 *  contains `focusMs`. Every cell has `inMonth=true`. */
export function buildWeekGrid(
	focusMs: number,
	nowMs: number,
	weekStartsOn: WeekStartsOn,
): GridCell[] {
	const start = startOfWeek(focusMs, weekStartsOn);
	const todayKey = dateKey(nowMs);
	const focusDate = new Date(startOfDay(focusMs));
	const focusYear = focusDate.getFullYear();
	const focusMonth = focusDate.getMonth();
	const out: GridCell[] = new Array(7);
	for (let i = 0; i < 7; i += 1) {
		const ms = addDays(start, i);
		out[i] = cellFor(ms, todayKey, sameMonth(ms, focusYear, focusMonth));
	}
	return out;
}

/** 6×7 month grid for the month containing `focusMs`. Always starts on
 *  a `weekStartsOn` weekday and ends on its predecessor — the renderer
 *  never has to test for partial rows. */
export function buildMonthGrid(
	focusMs: number,
	nowMs: number,
	weekStartsOn: WeekStartsOn,
): GridCell[][] {
	const start = startOfMonthGrid(focusMs, weekStartsOn);
	const todayKey = dateKey(nowMs);
	const focusDate = new Date(startOfDay(focusMs));
	const focusYear = focusDate.getFullYear();
	const focusMonth = focusDate.getMonth();
	const out: GridCell[][] = new Array(6);
	for (let row = 0; row < 6; row += 1) {
		const week: GridCell[] = new Array(7);
		for (let col = 0; col < 7; col += 1) {
			const ms = addDays(start, row * 7 + col);
			week[col] = cellFor(ms, todayKey, sameMonth(ms, focusYear, focusMonth));
		}
		out[row] = week;
	}
	return out;
}

/** Weekday short labels (locale-formatted) in display order for the
 *  configured `weekStartsOn`. */
export function weekdayLabels(weekStartsOn: WeekStartsOn): string[] {
	const out: string[] = new Array(7);
	// 2026-01-04 is a Sunday — anchor that guarantees we hit every weekday.
	const anchor = new Date(2026, 0, 4);
	for (let i = 0; i < 7; i += 1) {
		const d = new Date(
			anchor.getFullYear(),
			anchor.getMonth(),
			anchor.getDate() + ((weekStartsOn as number) % 7) + i,
		);
		out[i] = d.toLocaleDateString(undefined, { weekday: "short" });
	}
	return out;
}

/* ── internals ────────────────────────────────────────────────────── */

function cellFor(ms: number, todayKey: string, inMonth: boolean): GridCell {
	const d = new Date(ms);
	const dk = dateKey(ms);
	const weekday = d.getDay();
	return {
		dateEpochMs: ms,
		dateKey: dk,
		dayOfMonth: d.getDate(),
		weekday,
		isToday: dk === todayKey,
		inMonth,
		isWeekend: weekday === 0 || weekday === 6,
	};
}

function sameMonth(ms: number, focusYear: number, focusMonth: number): boolean {
	const d = new Date(ms);
	return d.getFullYear() === focusYear && d.getMonth() === focusMonth;
}
