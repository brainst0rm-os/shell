/**
 * Resolve which date property a cross-app drop should write (DND-4,
 * docs/platform/65 §Part III "set-property"). When an object dragged from
 * another app lands on a Calendar day cell, the calendar sets one of the
 * object's date properties to that day. This module decides *which* key, purely
 * (no DOM, no service) so the decision is unit-testable.
 *
 * Rule:
 *   1. If the dropped entity already carries a plausible value under one of the
 *      date keys, reuse THAT key — dragging a task with a `dueAt` reschedules
 *      its `dueAt`, not some other date. When several match, the highest-
 *      priority well-known key wins (a stable order, so the choice is
 *      deterministic regardless of property iteration order).
 *   2. Otherwise fall back to the default key (`scheduledAt`) — a freshly-dated
 *      object lands on its schedule.
 *
 * The cell's day start (local midnight) is the new date's *day*; the time-of-day
 * is preserved from any existing value under the chosen key (so a 09:30 task
 * dragged to another day stays 09:30), else defaults to the cell's day start.
 */

import { WELL_KNOWN_DATE_KEYS } from "./from-vault-entities";

/** The key written when the dropped object carries no existing date value. */
export const DEFAULT_DROP_DATE_KEY = "scheduledAt";

// Plausible epoch-ms window (mirrors `from-vault-entities`): a value under a
// date-ish key only counts as "already dated" inside this band, so a stray
// small number doesn't claim the key.
const MIN_PLAUSIBLE_MS = Date.UTC(2001, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

function isPlausibleDate(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_PLAUSIBLE_MS &&
		value <= MAX_PLAUSIBLE_MS
	);
}

/** Priority order for "which existing key wins" — the well-known keys in their
 *  declared order, with the default first so it's preferred on a tie. The
 *  default leads because, all else equal, a schedule date is the calendar's
 *  primary placement. */
function priorityKeys(dateKeys: ReadonlySet<string>): string[] {
	const wellKnown = Object.keys(WELL_KNOWN_DATE_KEYS);
	const ordered = [DEFAULT_DROP_DATE_KEY, ...wellKnown.filter((k) => k !== DEFAULT_DROP_DATE_KEY)];
	// Append any catalog-only keys (present in `dateKeys` but not well-known) so
	// an entity dated solely under a custom Date property still reuses that key.
	for (const key of dateKeys) {
		if (!ordered.includes(key)) ordered.push(key);
	}
	return ordered;
}

/** The property key a drop should write for `properties`, given the live set of
 *  date-typed keys. Reuses an existing dated key (highest priority first) or
 *  falls back to {@link DEFAULT_DROP_DATE_KEY}. */
export function resolveDropDateKey(
	properties: Record<string, unknown>,
	dateKeys: ReadonlySet<string>,
): string {
	for (const key of priorityKeys(dateKeys)) {
		if (dateKeys.has(key) && isPlausibleDate(properties[key])) return key;
	}
	return DEFAULT_DROP_DATE_KEY;
}

/** The new epoch-ms value to write: `dayStart` (local midnight of the target
 *  cell) carrying the time-of-day of any existing value under `key`, else the
 *  bare `dayStart`. Preserves a 09:30 task's clock when re-dated to another day;
 *  a date-only / unset value lands at midnight. */
export function dropDateValue(existing: unknown, dayStart: number): number {
	if (!isPlausibleDate(existing)) return dayStart;
	const d = new Date(existing);
	const timeOfDayMs =
		d.getHours() * 3_600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
	return dayStart + timeOfDayMs;
}
