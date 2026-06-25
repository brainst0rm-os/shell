/**
 * Pure `Reminder/v1` state transitions, shared by the shell-side
 * `ReminderRunner` (11b.5) and the Automations app's reminder surface
 * (11b.12 quick-capture + row actions). A reminder's whole schedule is
 * derivable from its persisted fields, so a transition is just an
 * immutable field rewrite — no timers, no IO; the caller passes the
 * instant explicitly.
 *
 * Extracted at copy two (the runner had them inline; the app needs the
 * same Done/Snooze semantics) per the DRY rule — one definition of what
 * "snooze" and "done" mean to a reminder.
 */

import type { ReminderDef } from "./automations";

/** Immutable "Snooze" transition: push the next fire to `untilMs` and
 *  re-open a previously-completed reminder (drops `completedAt`). */
export function snoozeReminder(reminder: ReminderDef, untilMs: number): ReminderDef {
	const next: ReminderDef = {
		subject: reminder.subject,
		dueAt: reminder.dueAt,
		snoozedUntil: new Date(untilMs).toISOString(),
	};
	if (reminder.target) next.target = reminder.target;
	if (reminder.recurrence) next.recurrence = reminder.recurrence;
	return next;
}

/** Immutable "Done" transition: mark complete at `atMs` and clear any
 *  pending snooze. For a recurring reminder this completes the current
 *  occurrence; the schedule still supplies the next one. */
export function completeReminder(reminder: ReminderDef, atMs: number): ReminderDef {
	const next: ReminderDef = {
		subject: reminder.subject,
		dueAt: reminder.dueAt,
		completedAt: new Date(atMs).toISOString(),
	};
	if (reminder.target) next.target = reminder.target;
	if (reminder.recurrence) next.recurrence = reminder.recurrence;
	return next;
}
