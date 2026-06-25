import { describe, expect, it } from "vitest";
import {
	compareJournalKeys,
	dateKeyForJournal,
	isJournalNoteTitle,
	journalEntryIdForKey,
	journalEntryIdToDateMs,
	journalNoteTitle,
	parseJournalDateKey,
} from "./journal-keys";

function localDay(y: number, m: number, d: number): number {
	return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

describe("dateKeyForJournal", () => {
	it("zero-pads month + day to YYYY-MM-DD in local tz", () => {
		expect(dateKeyForJournal(localDay(2026, 5, 14))).toBe("2026-05-14");
		expect(dateKeyForJournal(localDay(2026, 1, 3))).toBe("2026-01-03");
	});

	it("accepts both number and Date", () => {
		expect(dateKeyForJournal(new Date(2026, 4, 14))).toBe("2026-05-14");
		expect(dateKeyForJournal(localDay(2026, 5, 14))).toBe("2026-05-14");
	});

	it("ignores intra-day time — `2026-05-14 18:00` still keys as 2026-05-14", () => {
		expect(dateKeyForJournal(new Date(2026, 4, 14, 18, 0).getTime())).toBe("2026-05-14");
	});
});

describe("parseJournalDateKey", () => {
	it("round-trips dateKeyForJournal → parseJournalDateKey for a normal day", () => {
		const original = localDay(2026, 5, 14);
		expect(parseJournalDateKey(dateKeyForJournal(original))).toBe(original);
	});

	it("rejects strings that don't strictly match YYYY-MM-DD", () => {
		expect(parseJournalDateKey("2026-5-14")).toBeNull();
		expect(parseJournalDateKey("2026-05-14 — gratitudes")).toBeNull();
		expect(parseJournalDateKey("not a date")).toBeNull();
		expect(parseJournalDateKey("")).toBeNull();
	});

	it("rejects out-of-range months + days (Feb 30, April 31, month 13, day 0)", () => {
		expect(parseJournalDateKey("2026-02-30")).toBeNull();
		expect(parseJournalDateKey("2026-04-31")).toBeNull();
		expect(parseJournalDateKey("2026-13-01")).toBeNull();
		expect(parseJournalDateKey("2026-00-15")).toBeNull();
		expect(parseJournalDateKey("2026-05-00")).toBeNull();
		expect(parseJournalDateKey("2026-05-32")).toBeNull();
	});

	it("accepts Feb 29 in a leap year, rejects in a non-leap year", () => {
		expect(parseJournalDateKey("2024-02-29")).toBe(localDay(2024, 2, 29));
		expect(parseJournalDateKey("2026-02-29")).toBeNull();
	});
});

describe("journalNoteTitle", () => {
	it("produces a long-form weekday + month + year (locale-dependent)", () => {
		const out = journalNoteTitle(localDay(2026, 5, 14));
		// Don't assert exact string — varies by host locale. Just assert
		// the shape we want is plausibly present.
		expect(out).toMatch(/2026/);
		expect(out.length).toBeGreaterThan(8);
	});
});

describe("compareJournalKeys", () => {
	it("matches chronological order because keys are zero-padded ISO", () => {
		expect(compareJournalKeys("2026-05-14", "2026-05-15")).toBeLessThan(0);
		expect(compareJournalKeys("2026-05-14", "2026-05-14")).toBe(0);
		expect(compareJournalKeys("2026-05-15", "2026-05-14")).toBeGreaterThan(0);
	});

	it("correctly orders across month + year boundaries", () => {
		expect(compareJournalKeys("2026-12-31", "2027-01-01")).toBeLessThan(0);
		expect(compareJournalKeys("2026-01-31", "2026-02-01")).toBeLessThan(0);
	});

	it("is a stable sort key", () => {
		const keys = ["2026-05-20", "2025-12-01", "2026-05-14"];
		expect([...keys].sort(compareJournalKeys)).toEqual(["2025-12-01", "2026-05-14", "2026-05-20"]);
	});
});

describe("isJournalNoteTitle", () => {
	it("true for canonical journal titles", () => {
		expect(isJournalNoteTitle("2026-05-14")).toBe(true);
		expect(isJournalNoteTitle("2024-02-29")).toBe(true);
	});

	it("false for non-matching note titles", () => {
		expect(isJournalNoteTitle("Meeting notes")).toBe(false);
		expect(isJournalNoteTitle("2026-05-14 — gratitudes")).toBe(false);
		expect(isJournalNoteTitle("2026/05/14")).toBe(false);
	});

	it("false for invalid dates that happen to match the regex", () => {
		expect(isJournalNoteTitle("2026-02-30")).toBe(false);
	});
});

describe("journalEntryIdToDateMs — round-trips an entry id to its day", () => {
	it("decodes a journal entry id back to local midnight", () => {
		const key = dateKeyForJournal(localDay(2026, 5, 14));
		const id = journalEntryIdForKey(key);
		expect(id).toBe("journal-2026-05-14");
		expect(journalEntryIdToDateMs(id)).toBe(localDay(2026, 5, 14));
	});

	it("returns null for an id without the journal prefix", () => {
		expect(journalEntryIdToDateMs("n_abc123")).toBeNull();
		expect(journalEntryIdToDateMs("io.brainstorm.notes/Note/v1")).toBeNull();
	});

	it("returns null for a journal-prefixed id whose key isn't a valid date", () => {
		expect(journalEntryIdToDateMs("journal-2026-02-30")).toBeNull();
		expect(journalEntryIdToDateMs("journal-not-a-date")).toBeNull();
	});
});
