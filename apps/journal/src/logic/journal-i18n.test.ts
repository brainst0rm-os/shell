import { describe, expect, it } from "vitest";
import { JOURNAL_I18N, buildJournalT } from "./journal-i18n";

describe("buildJournalT", () => {
	it("returns the English default for a known key", () => {
		const t = buildJournalT();
		expect(t("today")).toBe("Today");
		expect(t("noEntryYet")).toBe("No entry yet.");
		expect(t("openInNotes")).toBe("Open in Notes");
	});

	it("interpolates {count} in pluralised + counted strings", () => {
		const t = buildJournalT();
		expect(t("wordOne", { count: 1 })).toBe("1 word");
		expect(t("wordOther", { count: 4 })).toBe("4 words");
		expect(t("linkedFrom", { count: 3 })).toBe("Linked from (3)");
	});

	it("applies a partial override layer, keeping untranslated defaults", () => {
		const t = buildJournalT({ today: "Heute", day: "Tag" });
		expect(t("today")).toBe("Heute");
		expect(t("day")).toBe("Tag");
		expect(t("week")).toBe("Week");
	});

	it("covers every bare string the matrix flagged", () => {
		for (const key of [
			"previous",
			"next",
			"today",
			"noEntryYet",
			"writeHint",
			"iconPicker",
			"linkedFrom",
			"link",
			"mention",
			"day",
			"week",
			"month",
			"hasEntry",
		] as const) {
			expect(JOURNAL_I18N[key]).toBeTruthy();
		}
	});

	it("has dropped the legacy CTA key in favour of the placeholder + picker labels", () => {
		// The "Start today's journal" CTA was replaced by an implicit-create
		// placeholder editable + clickable title-row icon picker; the old
		// key shouldn't exist anywhere in the manifest.
		expect(Object.keys(JOURNAL_I18N)).not.toContain("startTodaysJournal");
	});
});
