/**
 * Attendee list helpers (9.15.17) — coercion + RSVP roll-up for
 * `Event.attendees`. Pure; the editor DOM lives in `ui/attendee-editor.ts`.
 */

import { type Attendee, AttendeeRsvp } from "../types/attendee";

export const ATTENDEE_RSVPS: readonly AttendeeRsvp[] = Object.freeze([
	AttendeeRsvp.Accepted,
	AttendeeRsvp.Tentative,
	AttendeeRsvp.Declined,
	AttendeeRsvp.NeedsAction,
]);

const RSVP_VALUES = new Set<string>(ATTENDEE_RSVPS);

/** Narrow a stored RSVP value, defaulting to `NeedsAction`. */
export function normalizeRsvp(raw: unknown): AttendeeRsvp {
	return typeof raw === "string" && RSVP_VALUES.has(raw)
		? (raw as AttendeeRsvp)
		: AttendeeRsvp.NeedsAction;
}

/** A very small email sanity check — non-empty, one `@`, a dot after it.
 *  Intentionally permissive (real validation belongs to the contact
 *  system); this only rejects obvious junk so an empty/garbage string
 *  becomes `null`. */
export function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const at = trimmed.indexOf("@");
	if (at <= 0) return null;
	if (trimmed.indexOf(".", at) < at) return null;
	return trimmed;
}

/** Coerce one stored row to an `Attendee`, or `null` when it has neither a
 *  usable name nor email (nothing to show). */
export function normalizeAttendee(raw: unknown): Attendee | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const name = typeof r.name === "string" ? r.name.trim() : "";
	const email = normalizeEmail(r.email);
	if (name.length === 0 && email === null) return null;
	return {
		name: name.length > 0 ? name : (email as string),
		email,
		rsvp: normalizeRsvp(r.rsvp),
	};
}

/** Coerce a stored list, dropping unusable rows and de-duplicating by the
 *  email (case-insensitive) when present, else by display name. */
export function normalizeAttendees(raw: unknown): Attendee[] {
	if (!Array.isArray(raw)) return [];
	const out: Attendee[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		const attendee = normalizeAttendee(item);
		if (!attendee) continue;
		const key = (attendee.email ?? attendee.name).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(attendee);
	}
	return out;
}

/** Build an attendee from raw name + email input (the add row), or `null`
 *  when both are empty. */
export function makeAttendee(name: string, email: string): Attendee | null {
	return normalizeAttendee({ name, email, rsvp: AttendeeRsvp.NeedsAction });
}

export type RsvpCounts = Record<AttendeeRsvp, number>;

/** Tally attendees by RSVP state — feeds a "3 yes · 1 maybe" summary. */
export function rsvpCounts(attendees: readonly Attendee[]): RsvpCounts {
	const counts: RsvpCounts = {
		[AttendeeRsvp.Accepted]: 0,
		[AttendeeRsvp.Tentative]: 0,
		[AttendeeRsvp.Declined]: 0,
		[AttendeeRsvp.NeedsAction]: 0,
	};
	for (const a of attendees) counts[a.rsvp]++;
	return counts;
}
