import { describe, expect, it } from "vitest";
import { AttendeeRsvp } from "../types/attendee";
import {
	makeAttendee,
	normalizeAttendee,
	normalizeAttendees,
	normalizeEmail,
	normalizeRsvp,
	rsvpCounts,
} from "./attendees";

describe("attendees", () => {
	it("normalizes RSVP, defaulting unknown to needs-action", () => {
		expect(normalizeRsvp("accepted")).toBe(AttendeeRsvp.Accepted);
		expect(normalizeRsvp("bogus")).toBe(AttendeeRsvp.NeedsAction);
		expect(normalizeRsvp(undefined)).toBe(AttendeeRsvp.NeedsAction);
	});

	it("accepts plausible emails and rejects junk", () => {
		expect(normalizeEmail("a@b.co")).toBe("a@b.co");
		expect(normalizeEmail("  x@y.io ")).toBe("x@y.io");
		expect(normalizeEmail("nope")).toBeNull();
		expect(normalizeEmail("@b.co")).toBeNull();
		expect(normalizeEmail("a@bco")).toBeNull();
		expect(normalizeEmail("")).toBeNull();
	});

	it("builds an attendee, falling back to email for display when unnamed", () => {
		expect(normalizeAttendee({ name: "Mira", email: "m@x.io", rsvp: "accepted" })).toEqual({
			name: "Mira",
			email: "m@x.io",
			rsvp: AttendeeRsvp.Accepted,
		});
		expect(normalizeAttendee({ name: "", email: "m@x.io" })).toEqual({
			name: "m@x.io",
			email: "m@x.io",
			rsvp: AttendeeRsvp.NeedsAction,
		});
		expect(normalizeAttendee({ name: "", email: "junk" })).toBeNull();
	});

	it("normalizes a list, dropping junk + de-duping by email/name", () => {
		const out = normalizeAttendees([
			{ name: "Mira", email: "m@x.io" },
			{ name: "Mira again", email: "m@x.io" }, // dup email
			{ name: "Jules" },
			{ name: "Jules" }, // dup name
			{ nonsense: true },
		]);
		expect(out.map((a) => a.name)).toEqual(["Mira", "Jules"]);
	});

	it("makeAttendee returns null for empty input", () => {
		expect(makeAttendee("", "")).toBeNull();
		expect(makeAttendee("Sam", "")?.name).toBe("Sam");
	});

	it("tallies RSVP counts", () => {
		const counts = rsvpCounts([
			{ name: "a", email: null, rsvp: AttendeeRsvp.Accepted },
			{ name: "b", email: null, rsvp: AttendeeRsvp.Accepted },
			{ name: "c", email: null, rsvp: AttendeeRsvp.Declined },
		]);
		expect(counts[AttendeeRsvp.Accepted]).toBe(2);
		expect(counts[AttendeeRsvp.Declined]).toBe(1);
		expect(counts[AttendeeRsvp.Tentative]).toBe(0);
	});
});
