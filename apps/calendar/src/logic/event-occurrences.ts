/**
 * Pure helpers for laying out events on a Month / Week / Day grid.
 *
 * **Long-term keystone** per [[preview-drop-pattern]] — the Stage 9.3
 * entities-service swap changes the input source (live `Event/v1` rows
 * + Task `scheduledAt` + Note date properties) but the grid layout
 * math stays.
 *
 * Timezone: every helper operates in the host's local time zone via
 * the `Date` API. The Calendar app explicitly does NOT support a
 * per-vault "display in UTC" override in v1 — calendars are a
 * deeply-local experience.
 */

import type { Event } from "../types/event";

const DAY_MS = 86_400_000;

/** Stable date key (`YYYY-MM-DD` in local tz). Same shape as
 *  `apps/tasks/src/logic/date-buckets.ts::dateKey` so cross-app
 *  joining is trivial. */
export function dateKey(epochMs: number): string {
	const d = new Date(epochMs);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

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

export type DayBucket = {
	/** `YYYY-MM-DD`. */
	key: string;
	/** Epoch ms at start-of-day. */
	startOfDay: number;
	/** Events overlapping this day, ordered by `start` asc. */
	events: Event[];
};

/** Bucket events by each local day they overlap. Multi-day events
 *  appear in every day's bucket they span — the renderer decides
 *  whether to draw a ribbon (Month view) or separate boxes (Week / Day).
 *  Events without an `end` (instant events) appear in the single day
 *  their `start` falls on. */
export function indexByDay(events: readonly Event[]): DayBucket[] {
	const byKey = new Map<string, DayBucket>();

	for (const event of events) {
		const firstDay = startOfDay(event.start);
		const lastInstant = event.end ?? event.start;
		const lastDay = startOfDay(lastInstant);
		// Walk day-by-day so multi-day events register in each bucket.
		// We use addDay() rather than `+= DAY_MS` so DST transitions
		// don't accumulate off-by-one drift.
		for (let cursor = firstDay; cursor <= lastDay; cursor = addDay(cursor)) {
			const key = dateKey(cursor);
			let bucket = byKey.get(key);
			if (!bucket) {
				bucket = { key, startOfDay: cursor, events: [] };
				byKey.set(key, bucket);
			}
			bucket.events.push(event);
		}
	}

	const buckets = [...byKey.values()];
	buckets.sort((a, b) => a.startOfDay - b.startOfDay);
	for (const bucket of buckets) {
		bucket.events.sort((a, b) => a.start - b.start);
	}
	return buckets;
}

/** Add exactly one calendar day to an epoch-ms anchor, surviving DST
 *  transitions (a `+86_400_000` shift would land mid-day after a
 *  fall-back). Uses `setDate` semantics — which the JS engine handles
 *  TZ-correctly. */
export function addDay(epochMs: number): number {
	const d = new Date(epochMs);
	d.setDate(d.getDate() + 1);
	return d.getTime();
}

/** Is this event still in the future relative to `now`? An event is
 *  considered upcoming when its end (or start, for instant events) is
 *  strictly greater than `now`. Recurring-event expansion is the
 *  caller's responsibility — `indexByDay` operates on already-expanded
 *  occurrences. */
export function isUpcoming(event: Event, now: number): boolean {
	const finalInstant = event.end ?? event.start;
	return finalInstant > now;
}

/** Number of milliseconds in a calendar day. Exported so callers can do
 *  cheap "is this event multi-day?" checks without re-deriving. */
export const ONE_DAY_MS = DAY_MS;
