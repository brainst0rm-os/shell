import { describe, expect, it } from "vitest";
import type { BlockCommand } from "../block-command";
import { filterCommands } from "./slash-menu-plugin";

function cmd(id: string, label: string, keywords: string[]): BlockCommand {
	return { id, label, keywords, run: () => {} } as unknown as BlockCommand;
}

// Mirrors the real registry ordering: headings come before Sub-page, and
// their keywords ("subtitle" / "subheading") fuzzy-match "sub".
const COMMANDS = [
	cmd("h1", "Heading 1", ["heading", "h1", "title"]),
	cmd("h2", "Heading 2", ["heading", "h2", "subtitle"]),
	cmd("h3", "Heading 3", ["heading", "h3", "subheading"]),
	cmd("subpage", "Sub-page", ["page", "subpage", "sub-page", "child", "nested"]),
	cmd("quote", "Quote", ["quote", "blockquote"]),
];

describe("filterCommands ranking", () => {
	it("ranks the label-prefix match ('Sub-page') first for '/sub', not a keyword-only heading match", () => {
		const result = filterCommands(COMMANDS, "sub");
		expect(result.length).toBeGreaterThan(0);
		expect(result[0]?.id, `first match for "sub" should be Sub-page, got ${result[0]?.id}`).toBe(
			"subpage",
		);
	});

	it("an exact label match wins outright", () => {
		const result = filterCommands(COMMANDS, "quote");
		expect(result[0]?.id).toBe("quote");
	});

	it("returns all commands for an empty query", () => {
		expect(filterCommands(COMMANDS, "").length).toBe(COMMANDS.length);
	});

	it("keyword-substring matches still appear (just ranked lower)", () => {
		const result = filterCommands(COMMANDS, "sub");
		const ids = result.map((c) => c.id);
		expect(ids).toContain("h2");
		expect(ids).toContain("h3");
		expect(ids.indexOf("subpage")).toBeLessThan(ids.indexOf("h2"));
	});
});
