import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types/entry";
import { HabitId, MoodId } from "./check-in";
import { EMPTY_ENTRY_FILTERS, buildExcerpt, hasActiveSearch, searchEntries } from "./entry-search";

function entry(dateKey: string, preview: string, extra: Partial<JournalEntry> = {}): JournalEntry {
	const [y, m, d] = dateKey.split("-").map(Number);
	const epoch = new Date(y as number, (m as number) - 1, d as number).getTime();
	return {
		noteId: `journal-${dateKey}`,
		icon: null,
		dateEpochMs: epoch,
		dateKey,
		rawTitle: dateKey,
		preview,
		wordCount: preview.split(/\s+/).length,
		seedBody: null,
		values: {},
		mood: null,
		habits: [],
		createdAt: epoch,
		updatedAt: epoch,
		...extra,
	};
}

describe("searchEntries", () => {
	const entries = [
		entry("2026-05-14", "Shipped the graph clusters and felt great about it"),
		entry("2026-05-12", "Quiet morning, coffee and mountains", { mood: MoodId.Good }),
		entry("2026-04-30", "Read three papers on operational transforms", {
			habits: [HabitId.Read],
		}),
	];

	it("matches a term in the preview and ranks by score then date", () => {
		const r = searchEntries(entries, "coffee");
		expect(r).toHaveLength(1);
		expect(r[0]?.entry.dateKey).toBe("2026-05-12");
	});

	it("AND-matches multiple terms", () => {
		expect(searchEntries(entries, "graph clusters")).toHaveLength(1);
		expect(searchEntries(entries, "graph mountains")).toHaveLength(0);
	});

	it("scores a title (date-key) hit above a body hit", () => {
		const r = searchEntries(entries, "2026-05");
		expect(r.map((x) => x.entry.dateKey)).toEqual(["2026-05-14", "2026-05-12"]);
	});

	it("filters by mood", () => {
		const r = searchEntries(entries, "", { mood: MoodId.Good, habits: [] });
		expect(r.map((x) => x.entry.dateKey)).toEqual(["2026-05-12"]);
	});

	it("filters by habit (all required)", () => {
		const r = searchEntries(entries, "", { mood: null, habits: [HabitId.Read] });
		expect(r.map((x) => x.entry.dateKey)).toEqual(["2026-04-30"]);
	});

	it("combines text + filter", () => {
		expect(searchEntries(entries, "papers", { mood: null, habits: [HabitId.Read] })).toHaveLength(1);
		expect(searchEntries(entries, "coffee", { mood: null, habits: [HabitId.Read] })).toHaveLength(0);
	});

	it("returns all entries (date desc) for an empty search", () => {
		const r = searchEntries(entries, "", EMPTY_ENTRY_FILTERS);
		expect(r.map((x) => x.entry.dateKey)).toEqual(["2026-05-14", "2026-05-12", "2026-04-30"]);
	});
});

describe("hasActiveSearch", () => {
	it("is false only when query + filters are all empty", () => {
		expect(hasActiveSearch("", EMPTY_ENTRY_FILTERS)).toBe(false);
		expect(hasActiveSearch("x", EMPTY_ENTRY_FILTERS)).toBe(true);
		expect(hasActiveSearch("", { mood: MoodId.Bad, habits: [] })).toBe(true);
		expect(hasActiveSearch("", { mood: null, habits: [HabitId.Read] })).toBe(true);
	});
});

describe("buildExcerpt", () => {
	it("windows around the first match with ellipses", () => {
		const preview = `${"a".repeat(80)} needle ${"b".repeat(80)}`;
		const ex = buildExcerpt(preview, ["needle"]);
		expect(ex).toContain("needle");
		expect(ex.startsWith("…")).toBe(true);
		expect(ex.endsWith("…")).toBe(true);
	});

	it("returns the preview unchanged when no terms", () => {
		expect(buildExcerpt("hello", [])).toBe("hello");
	});
});
