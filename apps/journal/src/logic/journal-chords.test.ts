import { describe, expect, it } from "vitest";
import { JOURNAL_CHORDS, JournalChordId } from "./journal-chords";

describe("JOURNAL_CHORDS", () => {
	it("declares a chord for every JournalChordId", () => {
		for (const id of Object.values(JournalChordId)) {
			expect(typeof JOURNAL_CHORDS[id]).toBe("string");
			expect(JOURNAL_CHORDS[id].length).toBeGreaterThan(0);
		}
	});

	it("binds prev/next to the arrow keys and Today to a bare letter", () => {
		expect(JOURNAL_CHORDS[JournalChordId.PrevPeriod]).toBe("ArrowLeft");
		expect(JOURNAL_CHORDS[JournalChordId.NextPeriod]).toBe("ArrowRight");
		expect(JOURNAL_CHORDS[JournalChordId.GoToToday]).toBe("T");
	});

	it("scopes the open-in-Notes chord behind a modifier (avoids accidental fires)", () => {
		expect(JOURNAL_CHORDS[JournalChordId.OpenFocusedDay]).toContain("CmdOrCtrl+");
	});

	it("maps each mode to a distinct single-letter chord", () => {
		const modeChords = [
			JOURNAL_CHORDS[JournalChordId.ModeDay],
			JOURNAL_CHORDS[JournalChordId.ModeWeek],
			JOURNAL_CHORDS[JournalChordId.ModeMonth],
		];
		expect(new Set(modeChords).size).toBe(3);
	});

	it("is frozen — chords cannot be mutated at runtime", () => {
		expect(Object.isFrozen(JOURNAL_CHORDS)).toBe(true);
	});
});
