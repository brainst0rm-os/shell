/**
 * Cheatsheet (6.9, fancy-menus at 8.8) — tests cover the pure
 * resolve/filter/flatten helpers that feed the command-palette menu. The
 * rendered menu chrome (SearchInput panel + sectioned list + empty-state)
 * is a fancy-menus surface verified in the real shell via Playwright; the
 * filter-as-you-type wiring is the pure `filterGroups` + `flattenGroups`
 * pipeline exercised here.
 */

import { describe, expect, it } from "vitest";

import { filterGroups, flattenGroups, resolveGroups } from "./cheatsheet";

describe("resolveGroups", () => {
	it("populates every row with a label + chord + tokens", () => {
		const groups = resolveGroups(true);
		expect(groups.length).toBeGreaterThan(0);
		const all = groups.flatMap((g) => g.rows);
		expect(all.length).toBeGreaterThan(5);
		for (const row of all) {
			expect(row.id).toMatch(/^(shell|app|editor)\//);
			expect(typeof row.label).toBe("string");
			expect(row.label.length).toBeGreaterThan(0);
			// Most rows have chords; cleared bindings (null) are valid too.
			expect(row.chord === null || typeof row.chord === "string").toBe(true);
		}
	});

	it("renders chord tokens with mac glyphs when mac=true", () => {
		const groups = resolveGroups(true);
		const cheatsheetRow = groups.flatMap((g) => g.rows).find((r) => r.id === "shell/cheatsheet");
		expect(cheatsheetRow?.tokens).toEqual(["⌘", "⇧", "K"]);
	});

	it("renders chord tokens with verbatim names when mac=false", () => {
		const groups = resolveGroups(false);
		const cheatsheetRow = groups.flatMap((g) => g.rows).find((r) => r.id === "shell/cheatsheet");
		expect(cheatsheetRow?.tokens).toEqual(["Ctrl", "Shift", "K"]);
	});
});

describe("filterGroups", () => {
	const groups = resolveGroups(true);

	it("returns the input groups unchanged for an empty query", () => {
		expect(filterGroups(groups, "")).toBe(groups);
		expect(filterGroups(groups, "   ")).toBe(groups);
	});

	it("filters by label substring (case-insensitive)", () => {
		const out = filterGroups(groups, "MARKETPLACE");
		const ids = out.flatMap((g) => g.rows).map((r) => r.id);
		expect(ids).toContain("shell/marketplace");
		// Other unrelated actions filtered out.
		expect(ids).not.toContain("shell/quit");
	});

	it("filters by chord substring (case-insensitive)", () => {
		// `⌘⇧K` doesn't appear in chord strings (chords are the canonical
		// `CmdOrCtrl+Shift+K` form), so search for the canonical form.
		const out = filterGroups(groups, "Shift+K");
		const ids = out.flatMap((g) => g.rows).map((r) => r.id);
		expect(ids).toContain("shell/cheatsheet");
	});

	it("omits groups whose rows all filter out", () => {
		const out = filterGroups(groups, "nonexistent-string");
		expect(out).toEqual([]);
	});

	it("trims whitespace around the query", () => {
		const out = filterGroups(groups, "  cheatsheet  ");
		const ids = out.flatMap((g) => g.rows).map((r) => r.id);
		expect(ids).toContain("shell/cheatsheet");
	});
});

describe("flattenGroups", () => {
	it("emits a section header before each group's rows, in order", () => {
		const groups = resolveGroups(true);
		const items = flattenGroups(groups);
		// First item is a section header.
		expect(items[0]?.kind).toBe("section");
		// Every section header is immediately followed by at least one row.
		for (let i = 0; i < items.length; i++) {
			if (items[i]?.kind === "section") {
				expect(items[i + 1]?.kind).toBe("row");
			}
		}
		// Round-trips the row count.
		const flatRows = items.filter((it) => it.kind === "row");
		const groupRows = groups.flatMap((g) => g.rows);
		expect(flatRows.length).toBe(groupRows.length);
	});

	it("carries the launcher row with its chord tokens", () => {
		const items = flattenGroups(resolveGroups(true));
		const launcher = items.find((it) => it.kind === "row" && it.id === "shell/launcher");
		expect(launcher).toBeDefined();
		if (launcher?.kind === "row") expect(launcher.tokens.length).toBeGreaterThan(0);
	});
});
