import { describe, expect, it } from "vitest";
import { parseVEvent, serializeVEvent } from "./vevent-codec";

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0);

// Google-shaped: VTIMEZONE block + TZID-zoned times + attendees.
const GOOGLE_ICS = [
	"BEGIN:VCALENDAR",
	"PRODID:-//Google Inc//Google Calendar 70.9054//EN",
	"VERSION:2.0",
	"CALSCALE:GREGORIAN",
	"BEGIN:VTIMEZONE",
	"TZID:America/New_York",
	"BEGIN:DAYLIGHT",
	"TZOFFSETFROM:-0500",
	"TZOFFSETTO:-0400",
	"TZNAME:EDT",
	"DTSTART:19700308T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
	"END:DAYLIGHT",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"DTSTART;TZID=America/New_York:20260615T093000",
	"DTEND;TZID=America/New_York:20260615T103000",
	"DTSTAMP:20260610T120000Z",
	"UID:abc123@google.com",
	"CREATED:20260601T080000Z",
	"LAST-MODIFIED:20260610T110000Z",
	"LOCATION:Conference room 4",
	"SEQUENCE:1",
	"STATUS:CONFIRMED",
	"SUMMARY:Quarterly planning",
	"DESCRIPTION:Agenda:\\n- numbers\\, then plans",
	// Folded mid-value: the continuation line carries fold-space + content.
	"ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Dana",
	"  Lee:mailto:dana@example.com",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-PT30M",
	"END:VALARM",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

// Apple-shaped: UTC times, TENTATIVE status.
const APPLE_ICS = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Apple Inc.//macOS 15.0//EN",
	"BEGIN:VEVENT",
	"UID:9F2A6C8E-0001",
	"DTSTAMP:20260609T070000Z",
	"DTSTART:20260620T140000Z",
	"DTEND:20260620T150000Z",
	"SUMMARY:Dentist",
	"STATUS:TENTATIVE",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

// Fastmail-shaped: all-day VALUE=DATE + weekly RRULE.
const FASTMAIL_ICS = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Fastmail//CalDAV//EN",
	"BEGIN:VEVENT",
	"UID:fm-recurring-1",
	"DTSTAMP:20260601T000000Z",
	"DTSTART;VALUE=DATE:20260601",
	"RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
	"SUMMARY:Standup notes day",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("parseVEvent", () => {
	it("parses a Google payload: TZID instant, attendees, alarm, escaping", () => {
		const parsed = parseVEvent(GOOGLE_ICS, NOW);
		expect(parsed).not.toBeNull();
		expect(parsed?.uid).toBe("abc123@google.com");
		const p = parsed?.properties ?? {};
		expect(p.title).toBe("Quarterly planning");
		expect(p.description).toBe("Agenda:\n- numbers, then plans");
		expect(p.location).toBe("Conference room 4");
		// 09:30 America/New_York on 2026-06-15 (EDT, UTC-4) = 13:30Z.
		expect(p.start).toBe(Date.UTC(2026, 5, 15, 13, 30, 0));
		expect(p.end).toBe(Date.UTC(2026, 5, 15, 14, 30, 0));
		expect(p.timeZone).toBe("America/New_York");
		expect(p.allDay).toBe(false);
		expect(p.statusKey).toBe("confirmed");
		expect(p.reminders).toEqual([30]);
		expect(p.attendees).toEqual([{ name: "Dana Lee", email: "dana@example.com", rsvp: "accepted" }]);
		expect(p.createdAt).toBe(Date.UTC(2026, 5, 1, 8, 0, 0));
		expect(p.updatedAt).toBe(Date.UTC(2026, 5, 10, 11, 0, 0));
	});

	it("parses an Apple payload: UTC instants + tentative status", () => {
		const parsed = parseVEvent(APPLE_ICS, NOW);
		const p = parsed?.properties ?? {};
		expect(parsed?.uid).toBe("9F2A6C8E-0001");
		expect(p.start).toBe(Date.UTC(2026, 5, 20, 14, 0, 0));
		expect(p.end).toBe(Date.UTC(2026, 5, 20, 15, 0, 0));
		expect(p.timeZone).toBeNull();
		expect(p.statusKey).toBe("tentative");
		// DTSTAMP backstops updatedAt when LAST-MODIFIED is absent.
		expect(p.updatedAt).toBe(Date.UTC(2026, 5, 9, 7, 0, 0));
	});

	it("parses a Fastmail payload: all-day + structured weekly recurrence", () => {
		const parsed = parseVEvent(FASTMAIL_ICS, NOW);
		const p = parsed?.properties ?? {};
		expect(p.allDay).toBe(true);
		expect(p.end).toBeNull();
		expect(p.start).toBe(new Date(2026, 5, 1).getTime());
		expect(p.recurrence).toMatchObject({ kind: "weekly", days: ["mon", "wed"] });
	});

	it("rejects a payload with no usable VEVENT", () => {
		expect(parseVEvent("BEGIN:VCALENDAR\r\nEND:VCALENDAR", NOW)).toBeNull();
		const noStart = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:x",
			"SUMMARY:broken",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		expect(parseVEvent(noStart, NOW)).toBeNull();
	});

	it("an unknown TZID degrades to floating local time, not a throw", () => {
		const ics = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:tz-x",
			"DTSTART;TZID=Custom/Zone:20260615T093000",
			"SUMMARY:odd zone",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		const parsed = parseVEvent(ics, NOW);
		expect(parsed?.properties.start).toBe(new Date(2026, 5, 15, 9, 30, 0).getTime());
		expect(parsed?.properties.timeZone).toBeNull();
	});

	it("a DST-gap wall time still resolves to a finite instant", () => {
		const ics = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:dst-gap",
			// 2026-03-08 02:30 America/New_York does not exist (spring forward).
			"DTSTART;TZID=America/New_York:20260308T023000",
			"SUMMARY:gap",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		const parsed = parseVEvent(ics, NOW);
		expect(Number.isFinite(parsed?.properties.start)).toBe(true);
	});
});

describe("serializeVEvent", () => {
	it("emits a single-VEVENT VCALENDAR that parses back equivalently", () => {
		const properties = {
			title: "Review; with, specials",
			description: "Line one\nLine two",
			start: Date.UTC(2026, 5, 18, 9, 0, 0),
			end: Date.UTC(2026, 5, 18, 10, 0, 0),
			allDay: false,
			location: "HQ",
			recurrence: { kind: "daily", every: 2 },
			statusKey: "tentative",
			reminders: [10, 60],
			attendees: [{ name: "Bo", email: "bo@x.com", rsvp: "declined" }],
			timeZone: null,
			createdAt: NOW,
			updatedAt: NOW,
		};
		const ics = serializeVEvent({ uid: "uid-1", properties, now: NOW });
		expect(ics).not.toBeNull();
		expect(ics).toContain("UID:uid-1");
		expect(ics).toContain("DTSTART:20260618T090000Z");

		const roundTrip = parseVEvent(ics ?? "", NOW);
		expect(roundTrip?.uid).toBe("uid-1");
		const p = roundTrip?.properties ?? {};
		expect(p.title).toBe(properties.title);
		expect(p.description).toBe(properties.description);
		expect(p.start).toBe(properties.start);
		expect(p.end).toBe(properties.end);
		expect(p.statusKey).toBe("tentative");
		expect(p.recurrence).toMatchObject({ kind: "daily", every: 2 });
		expect(p.reminders).toEqual([10, 60]);
		expect(p.attendees).toEqual([{ name: "Bo", email: "bo@x.com", rsvp: "declined" }]);
	});

	it("all-day events emit VALUE=DATE and round-trip allDay", () => {
		const start = new Date(2026, 5, 20).getTime();
		const ics = serializeVEvent({
			uid: "uid-allday",
			properties: { title: "Offsite", start, allDay: true, updatedAt: NOW },
			now: NOW,
		});
		expect(ics).toContain("DTSTART;VALUE=DATE:20260620");
		const parsed = parseVEvent(ics ?? "", NOW);
		expect(parsed?.properties.allDay).toBe(true);
		expect(parsed?.properties.start).toBe(start);
	});

	it("returns null for properties with no finite start", () => {
		expect(serializeVEvent({ uid: "x", properties: { title: "?" }, now: NOW })).toBeNull();
	});

	it("folds long lines within the RFC budget and unfolds on parse", () => {
		const longTitle = "T".repeat(300);
		const ics = serializeVEvent({
			uid: "uid-long",
			properties: { title: longTitle, start: NOW, allDay: false, updatedAt: NOW },
			now: NOW,
		});
		for (const line of (ics ?? "").split("\r\n")) {
			expect(line.length).toBeLessThanOrEqual(75);
		}
		expect(parseVEvent(ics ?? "", NOW)?.properties.title).toBe(longTitle);
	});
});
