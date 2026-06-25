/**
 * Event status / availability — the `event-status` vocabulary the
 * `Event.statusKey` field keys into.
 *
 * Wire format stays the string enum values (`confirmed` / `tentative` /
 * `cancelled`) so a stored `statusKey` round-trips byte-for-byte and a
 * future shared dictionary can adopt the same keys. The renderer paints a
 * status treatment off `data-status` (cancelled → struck-through + dimmed,
 * tentative → translucent/hatched) so availability reads at a glance.
 */

export enum EventStatus {
	Confirmed = "confirmed",
	Tentative = "tentative",
	Cancelled = "cancelled",
}

/** Display order for the detail-surface picker — confirmed (the implicit
 *  default) first, then the two qualified states. */
export const EVENT_STATUSES: readonly EventStatus[] = Object.freeze([
	EventStatus.Confirmed,
	EventStatus.Tentative,
	EventStatus.Cancelled,
]);

const STATUS_VALUES = new Set<string>(EVENT_STATUSES);

/** Narrow an arbitrary stored value to a known `EventStatus`, or `null`
 *  when it's absent / unrecognised (so a malformed sync row degrades to
 *  "no explicit status" rather than throwing). */
export function normalizeStatusKey(raw: unknown): EventStatus | null {
	return typeof raw === "string" && STATUS_VALUES.has(raw) ? (raw as EventStatus) : null;
}

/** An explicit status the user picked, treated as "no status set" when it
 *  is the implicit default (Confirmed). Lets the detail surface persist
 *  `null` for the common case so an untouched event carries no statusKey. */
export function statusToStored(status: EventStatus): EventStatus | null {
	return status === EventStatus.Confirmed ? null : status;
}
