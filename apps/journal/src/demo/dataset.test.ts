import { describe, expect, it } from "vitest";
import { isJournalNoteTitle } from "../logic/journal-keys";
import { projectJournalEntries } from "../logic/journal-projection";
import { buildJournalDemo, demoAnchorDate } from "./dataset";

describe("journal demo dataset", () => {
	it("returns at least 28 entries", () => {
		const entries = buildJournalDemo();
		expect(entries.length).toBeGreaterThanOrEqual(28);
	});

	it("titles all canonical ISO date keys (so the projection sees them)", () => {
		const entries = buildJournalDemo();
		for (const e of entries) {
			expect(isJournalNoteTitle(e.title)).toBe(true);
		}
	});

	it("anchor matches 2026-05-14 (the project's stable timestamp)", () => {
		const d = demoAnchorDate();
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(4);
		expect(d.getDate()).toBe(14);
	});

	it("produces projection rows ending on the anchor (today's entry)", () => {
		const projected = projectJournalEntries(buildJournalDemo());
		const last = projected[projected.length - 1];
		expect(last?.dateKey).toBe("2026-05-14");
	});

	it("entries are sparse — the dataset includes deliberate gap days", () => {
		const projected = projectJournalEntries(buildJournalDemo());
		const dateKeys = new Set(projected.map((e) => e.dateKey));
		// Sample three days the dataset deliberately skips; the renderer
		// must handle these gaps (no entry indicator, "Start today's
		// journal" prompt when the gap is the focused day).
		expect(dateKeys.has("2026-05-11")).toBe(false); // 3 days ago
		expect(dateKeys.has("2026-05-07")).toBe(false); // 7 days ago
		expect(dateKeys.has("2026-05-05")).toBe(false); // 9 days ago
	});
});
