import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types/entry";
import { groupEntriesByMonth, monthLabelFromKey } from "./entry-overview";

function entry(dateKey: string): JournalEntry {
	const [y, m, d] = dateKey.split("-").map(Number);
	const epoch = new Date(y as number, (m as number) - 1, d as number).getTime();
	return {
		noteId: `journal-${dateKey}`,
		icon: null,
		dateEpochMs: epoch,
		dateKey,
		rawTitle: dateKey,
		preview: "",
		wordCount: 0,
		seedBody: null,
		values: {},
		mood: null,
		habits: [],
		createdAt: epoch,
		updatedAt: epoch,
	};
}

describe("groupEntriesByMonth", () => {
	it("buckets entries by YYYY-MM, newest month first", () => {
		const sections = groupEntriesByMonth([
			entry("2026-04-30"),
			entry("2026-05-14"),
			entry("2026-06-01"),
		]);
		expect(sections.map((s) => s.monthKey)).toEqual(["2026-06", "2026-05", "2026-04"]);
	});

	it("orders entries within a month newest day first", () => {
		const sections = groupEntriesByMonth([
			entry("2026-05-02"),
			entry("2026-05-20"),
			entry("2026-05-11"),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0]?.entries.map((e) => e.dateKey)).toEqual([
			"2026-05-20",
			"2026-05-11",
			"2026-05-02",
		]);
	});

	it("spans year boundaries in calendar order", () => {
		const sections = groupEntriesByMonth([entry("2025-12-31"), entry("2026-01-01")]);
		expect(sections.map((s) => s.monthKey)).toEqual(["2026-01", "2025-12"]);
	});

	it("returns an empty array for no entries", () => {
		expect(groupEntriesByMonth([])).toEqual([]);
	});
});

describe("monthLabelFromKey", () => {
	it("renders a long month + year label", () => {
		// Locale-dependent month name; assert it contains the year and is not
		// the raw key (the exact word varies by host locale).
		const label = monthLabelFromKey("2026-05");
		expect(label).toContain("2026");
		expect(label).not.toBe("2026-05");
	});

	it("passes through a malformed key unchanged", () => {
		expect(monthLabelFromKey("nope")).toBe("nope");
		expect(monthLabelFromKey("2026-13")).toBe("2026-13");
	});
});
