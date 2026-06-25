import { describe, expect, it } from "vitest";
import { JournalDayBodyMode, journalDayBodyMode } from "./day-body-mode";

describe("journalDayBodyMode", () => {
	it("renders the live editor when the day already has an entry", () => {
		expect(journalDayBodyMode({ hasEntry: true, canMutate: true })).toBe(JournalDayBodyMode.Editor);
	});

	it("offers an implicit-create placeholder for an empty mutable day", () => {
		expect(journalDayBodyMode({ hasEntry: false, canMutate: true })).toBe(
			JournalDayBodyMode.ImplicitCreate,
		);
	});

	it("stays read-only for an empty day on a non-mutating surface", () => {
		expect(journalDayBodyMode({ hasEntry: false, canMutate: false })).toBe(
			JournalDayBodyMode.ReadOnlyEmpty,
		);
	});

	it("decides independently of which day is focused — past, present, and future empty days are all editable", () => {
		// The decision takes no date: the old today-only gate is gone, so
		// back-dating and forward-dating entries are both first-class. Whatever
		// the focused day, an empty mutable day offers the create placeholder.
		for (const _day of ["2020-01-01", "today", "2099-12-31"]) {
			expect(journalDayBodyMode({ hasEntry: false, canMutate: true })).toBe(
				JournalDayBodyMode.ImplicitCreate,
			);
		}
	});
});
