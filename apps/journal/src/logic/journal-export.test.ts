import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types/entry";
import { HabitId, MoodId } from "./check-in";
import { entriesInRange, journalToHtml, journalToMarkdown } from "./journal-export";

function entry(dateKey: string, over: Partial<JournalEntry> = {}): JournalEntry {
	const [y, m, d] = dateKey.split("-").map(Number);
	const epoch = new Date(y as number, (m as number) - 1, d as number).getTime();
	return {
		noteId: `journal-${dateKey}`,
		icon: null,
		dateEpochMs: epoch,
		dateKey,
		rawTitle: dateKey,
		preview: "a day",
		wordCount: 2,
		seedBody: null,
		values: {},
		mood: null,
		habits: [],
		createdAt: epoch,
		updatedAt: epoch,
		...over,
	};
}

const labels = {
	title: "Journal",
	moodLabel: (m: MoodId) => m,
	habitLabel: (h: HabitId) => h,
	words: (n: number) => `${n} words`,
};

describe("entriesInRange", () => {
	it("includes the range bounds and sorts oldest first", () => {
		const all = [entry("2026-05-20"), entry("2026-05-01"), entry("2026-06-05")];
		const start = new Date(2026, 4, 1).getTime();
		const end = new Date(2026, 4, 31).getTime();
		const r = entriesInRange(all, start, end);
		expect(r.map((e) => e.dateKey)).toEqual(["2026-05-01", "2026-05-20"]);
	});
});

describe("journalToMarkdown", () => {
	it("renders a heading, meta line, and preview per entry", () => {
		const md = journalToMarkdown(
			[entry("2026-05-14", { mood: MoodId.Great, habits: [HabitId.Read], preview: "shipped it" })],
			labels,
		);
		expect(md).toContain("# Journal");
		expect(md).toMatch(/## .*2026/);
		expect(md).toContain("😄 great");
		expect(md).toContain("2 words");
		expect(md).toContain("read");
		expect(md).toContain("shipped it");
		expect(md.endsWith("\n")).toBe(true);
	});

	it("omits the mood/habits segments when absent", () => {
		const md = journalToMarkdown([entry("2026-05-14", { preview: "" })], labels);
		expect(md).not.toContain("·  ·"); // no empty segments
		expect(md).toContain("2 words");
	});
});

describe("journalToHtml", () => {
	it("produces a self-contained doc and escapes content", () => {
		const html = journalToHtml([entry("2026-05-14", { preview: 'a <b> & "q"' })], labels);
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain("&lt;b&gt;");
		expect(html).toContain("&amp;");
		expect(html).toContain("&quot;");
		expect(html).not.toContain("<b>");
	});
});
