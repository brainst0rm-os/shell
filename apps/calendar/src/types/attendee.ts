/**
 * `Attendee` — a participant on an `Event/v1` (9.15.17). Mirrors the
 * iCalendar ATTENDEE model loosely: a display name, an optional email,
 * and an RSVP/PARTSTAT state. The structured shape stays small + wire-
 * stable so an ICS round-trip (9.15.18) can map it without a second model.
 */

export enum AttendeeRsvp {
	NeedsAction = "needs-action",
	Accepted = "accepted",
	Declined = "declined",
	Tentative = "tentative",
}

export type Attendee = {
	name: string;
	/** Optional contact email. An attendee with no name falls back to the
	 *  email for display, so at least one of the two is always present. */
	email: string | null;
	rsvp: AttendeeRsvp;
};
