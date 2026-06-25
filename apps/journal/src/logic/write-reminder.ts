/**
 * Write-reminder scheduler (9.16.11) — pure decision logic for the daily
 * "time to journal" nudge. The app persists the user's enabled/time
 * preference + the last-fired day key in `localStorage` and ticks an
 * interval while open; this module decides *whether* a tick should fire,
 * with no clock or storage of its own (so it's fully unit-testable).
 *
 * The nudge fires at most once per day, only after the target time of day
 * has passed, and only while today's entry is still unwritten — writing the
 * entry (or having already been nudged today) suppresses it.
 */

/** Minutes since local midnight for a `Date`. */
export function minutesOfDay(d: Date): number {
	return d.getHours() * 60 + d.getMinutes();
}

/** Parse an `HH:MM` (24h) time to minutes-of-day, or null if malformed. */
export function parseReminderTime(raw: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h < 0 || h > 23 || min < 0 || min > 59) return null;
	return h * 60 + min;
}

/** Format minutes-of-day back to a zero-padded `HH:MM`. */
export function formatReminderTime(minutes: number): string {
	const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(minutes)));
	const h = Math.floor(clamped / 60);
	const m = clamped % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type WriteReminderTick = {
	now: Date;
	/** Target time-of-day in minutes since midnight. */
	targetMinutes: number;
	/** `YYYY-MM-DD` of the last day a reminder fired, or null. */
	lastFiredDateKey: string | null;
	/** Today's `YYYY-MM-DD`. */
	todayKey: string;
	/** Whether today's entry already exists (writing suppresses the nudge). */
	hasTodayEntry: boolean;
};

/** Whether this tick should fire the write reminder. */
export function shouldFireWriteReminder(tick: WriteReminderTick): boolean {
	if (tick.hasTodayEntry) return false;
	if (tick.lastFiredDateKey === tick.todayKey) return false;
	return minutesOfDay(tick.now) >= tick.targetMinutes;
}
