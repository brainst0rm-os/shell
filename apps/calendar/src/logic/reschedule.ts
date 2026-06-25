/**
 * Pure reschedule math for drag-to-reschedule (9.15).
 *
 * Moving an event to a new start instant shifts its `end` by the same
 * delta so the duration is preserved (an instant event keeps `end:
 * null`). Kept pure + separate from the DOM drag handler so the
 * arithmetic is unit-testable without jsdom.
 */

import type { Event } from "../types/event";

/** Snap an arbitrary epoch-ms instant to the nearest `stepMinutes`
 *  boundary (drag handlers snap to 15-min slots). */
export function snapToMinutes(epochMs: number, stepMinutes: number): number {
	const stepMs = stepMinutes * 60_000;
	return Math.round(epochMs / stepMs) * stepMs;
}

/** Move `epochMs` to the same wall-clock time on the day starting at
 *  `targetDayStart` (local midnight). Used by Month-view chip drag so a
 *  9:30 event dragged onto a different cell stays 9:30 on the new day —
 *  a DST shift on either side falls out of the local Date arithmetic
 *  (the result is the wall-clock time, not the offset-preserved epoch).
 *  All-day items are 00:00 on the origin day, so they shift to 00:00 on
 *  the target day. */
export function shiftToDay(epochMs: number, targetDayStart: number): number {
	const d = new Date(epochMs);
	const timeOfDayMs =
		d.getHours() * 3_600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
	return targetDayStart + timeOfDayMs;
}

/** Return a new Event moved so it starts at `newStart`, preserving
 *  duration. The input is never mutated. */
export function rescheduleEvent(event: Event, newStart: number): Event {
	const delta = newStart - event.start;
	return {
		...event,
		start: newStart,
		end: event.end === null ? null : event.end + delta,
		updatedAt: Date.now(),
	};
}
