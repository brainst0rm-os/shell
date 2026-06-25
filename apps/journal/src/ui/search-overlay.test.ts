// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoodId } from "../logic/check-in";
import { buildJournalT } from "../logic/journal-i18n";
import type { JournalEntry } from "../types/entry";
import { openJournalSearch } from "./search-overlay";

const t = buildJournalT();

function entry(dateKey: string, preview: string, mood: MoodId | null = null): JournalEntry {
	const [y, m, d] = dateKey.split("-").map(Number);
	const epoch = new Date(y as number, (m as number) - 1, d as number).getTime();
	return {
		noteId: `journal-${dateKey}`,
		icon: null,
		dateEpochMs: epoch,
		dateKey,
		rawTitle: dateKey,
		preview,
		wordCount: 2,
		seedBody: null,
		values: {},
		mood,
		habits: [],
		createdAt: epoch,
		updatedAt: epoch,
	};
}

afterEach(() => document.body.replaceChildren());

function typeInto(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

const ENTRIES = [
	entry("2026-05-14", "shipped the graph clusters"),
	entry("2026-05-12", "quiet coffee morning", MoodId.Good),
];

describe("openJournalSearch", () => {
	it("shows the hint when empty, then filters live", () => {
		openJournalSearch({ t, getEntries: () => ENTRIES, onPick: vi.fn() });
		const input = document.querySelector<HTMLInputElement>(".journal-search__input");
		if (!input) throw new Error("no input");
		expect(document.querySelector<HTMLElement>(".journal-search__status")?.hidden).toBe(false);

		typeInto(input, "coffee");
		const rows = document.querySelectorAll(".journal-search__row");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.querySelector(".journal-search__excerpt")?.textContent).toContain("coffee");
	});

	it("Enter picks the active row and fires onPick with the entry", () => {
		const onPick = vi.fn();
		openJournalSearch({ t, getEntries: () => ENTRIES, onPick });
		const input = document.querySelector<HTMLInputElement>(".journal-search__input");
		if (!input) throw new Error("no input");
		typeInto(input, "graph");
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick.mock.calls[0]?.[0]?.dateKey).toBe("2026-05-14");
	});

	it("a mood filter chip narrows results without a text query", () => {
		openJournalSearch({ t, getEntries: () => ENTRIES, onPick: vi.fn() });
		const chips = document.querySelectorAll<HTMLButtonElement>(".journal-search__chip");
		// The 'good' mood chip is the 2nd mood (great, good, ...).
		const goodChip = chips[1];
		if (!goodChip) throw new Error("no chip");
		goodChip.click();
		expect(goodChip.getAttribute("aria-pressed")).toBe("true");
		const rows = document.querySelectorAll(".journal-search__row");
		expect(rows).toHaveLength(1);
	});

	it("KBN-A: results form a combobox listbox driven from the input", () => {
		openJournalSearch({ t, getEntries: () => ENTRIES, onPick: vi.fn() });
		const input = document.querySelector<HTMLInputElement>(".journal-search__input");
		if (!input) throw new Error("no input");
		// 'e' appears in both previews ("shipped the…", "coffee…") — a query that
		// returns multiple rows so ArrowDown has somewhere to go.
		typeInto(input, "e");
		const list = document.querySelector<HTMLElement>(".journal-search__results");
		const rows = document.querySelectorAll<HTMLElement>(".journal-search__row");
		expect(rows.length).toBeGreaterThan(1);
		// Roles flow from the binding (not hand-written here).
		expect(list?.getAttribute("role")).toBe("listbox");
		expect(rows[0]?.getAttribute("role")).toBe("option");
		// activedescendant lives on the input; row 0 is active.
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);
		expect(rows[0]?.dataset.active).toBe("true");
		// ArrowDown on the input moves the cursor to row 1.
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(input.getAttribute("aria-activedescendant")).toBe(rows[1]?.id);
		expect(rows[1]?.dataset.active).toBe("true");
		expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("the mood + habit filter rows keep their group role", () => {
		openJournalSearch({ t, getEntries: () => ENTRIES, onPick: vi.fn() });
		const groups = document.querySelectorAll<HTMLElement>(".journal-search__filter");
		expect(groups).toHaveLength(2);
		for (const g of groups) expect(g.getAttribute("role")).toBe("group");
	});
});
