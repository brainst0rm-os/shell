/**
 * Reminder offsets + in-app reminder scheduler — extracted from the Calendar
 * app (9.15.16) at copy two when Tasks adopted due/scheduled alerts (9.14.9).
 * One scheduling model product-wide: an item exposes minutes-before-`start`
 * offsets (`0` = at start); the pure window function answers "which fire
 * instants fell into `(after, through]`?", and the small stateful scheduler
 * a host ticks on an interval fires each unique (id, fireAt) at most once.
 * Keeping the window math pure makes fire-exactly-once testable with no
 * timers.
 */

/** The preset offsets a detail surface offers (minutes before start).
 *  `0` = at start, then 5 / 10 / 30 minutes, 1 hour, 1 day. */
export const REMINDER_PRESET_MINUTES: readonly number[] = Object.freeze([0, 5, 10, 30, 60, 1440]);

const MINUTE_MS = 60_000;

/** Coerce a stored value to a clean reminder list: finite non-negative
 *  integers, de-duplicated, sorted ascending. Anything malformed drops
 *  out (so a corrupted sync row degrades to fewer reminders, never throws). */
export function normalizeReminders(raw: unknown): number[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<number>();
	for (const v of raw) {
		if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
		seen.add(Math.floor(v));
	}
	return [...seen].sort((a, b) => a - b);
}

/** The instant a reminder fires for an item starting at `start`. */
export function reminderInstant(start: number, minutesBefore: number): number {
	return start - minutesBefore * MINUTE_MS;
}

/** Toggle a single offset in/out of a reminder list, returning a fresh
 *  normalized list (a detail surface's preset checkboxes use this). */
export function toggleReminder(reminders: readonly number[], minutes: number): number[] {
	const present = reminders.includes(minutes);
	const next = present ? reminders.filter((m) => m !== minutes) : [...reminders, minutes];
	return normalizeReminders(next);
}

/** The minimum an item must carry for the scheduler to reason about it. */
export type ReminderSource = {
	id: string;
	title: string;
	start: number;
	reminders: readonly number[];
};

export type DueReminder = {
	/** Source item id. */
	id: string;
	title: string;
	/** The offset (minutes before start) that came due. */
	minutes: number;
	/** The instant the reminder fired. */
	fireAt: number;
	/** The item's start instant. */
	start: number;
	/** Stable cross-window identity for this logical alert — `${id}#${fireAt}`.
	 *  Two windows of the same app run independent schedulers and each fires
	 *  the alert once; passing this as the notification's `dedupeKey` lets the
	 *  shell collapse the duplicate so it's recorded/popped exactly once. */
	dedupeKey: string;
};

/** The stable cross-window dedupe key for a reminder firing at `fireAt`
 *  for the source `id`. The shell `UiNotifyHost` dedupes on `(appId, key)`. */
export function reminderDedupeKey(id: string, fireAt: number): string {
	return `${id}#${fireAt}`;
}

/** Reminder fire-instants in `(after, through]`, sorted ascending. An
 *  item with no reminders, or whose offsets all fire outside the window,
 *  contributes nothing. */
export function dueRemindersInWindow(
	items: readonly ReminderSource[],
	after: number,
	through: number,
): DueReminder[] {
	const out: DueReminder[] = [];
	for (const item of items) {
		for (const minutes of item.reminders) {
			const fireAt = reminderInstant(item.start, minutes);
			if (fireAt > after && fireAt <= through) {
				out.push({
					id: item.id,
					title: item.title,
					minutes,
					fireAt,
					start: item.start,
					dedupeKey: reminderDedupeKey(item.id, fireAt),
				});
			}
		}
	}
	out.sort((a, b) => a.fireAt - b.fireAt);
	return out;
}

export type ReminderNotifier = (reminder: DueReminder) => void;

export type ReminderScheduler = {
	/** Advance the scheduler to `now`, firing every reminder that came due
	 *  since the previous tick. Fires each unique (id, fireAt) at most once,
	 *  so overlapping windows / re-ticks never double-notify. */
	tick(now: number): void;
	dispose(): void;
};

export type ReminderSchedulerOptions = {
	getItems: () => readonly ReminderSource[];
	notify: ReminderNotifier;
	/** The instant the scheduler is anchored at on creation — reminders
	 *  already in the past relative to this are not back-fired. */
	startedAt: number;
};

export function createReminderScheduler(opts: ReminderSchedulerOptions): ReminderScheduler {
	let last = opts.startedAt;
	const fired = new Set<string>();

	return {
		tick(now: number): void {
			if (now <= last) return;
			for (const due of dueRemindersInWindow(opts.getItems(), last, now)) {
				const key = `${due.id}@${due.fireAt}`;
				if (fired.has(key)) continue;
				fired.add(key);
				opts.notify(due);
			}
			last = now;
		},
		dispose(): void {
			fired.clear();
		},
	};
}
