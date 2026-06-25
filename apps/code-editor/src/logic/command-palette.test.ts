import { describe, expect, it, vi } from "vitest";
import { type EditorCommand, rankCommands } from "./command-palette";

function cmd(id: string, label: string, keywords?: readonly string[]): EditorCommand {
	return { id, label, run: vi.fn(), ...(keywords ? { keywords } : {}) };
}

describe("rankCommands", () => {
	const commands = [
		cmd("save", "Save file", ["write"]),
		cmd("new", "New file", ["create"]),
		cmd("tab-next", "Next tab"),
		cmd("close", "Close tab", ["remove"]),
	];

	it("returns every command in input order for an empty query", () => {
		const ranked = rankCommands(commands, "");
		expect(ranked.map((c) => c.id)).toEqual(["save", "new", "tab-next", "close"]);
	});

	it("treats a whitespace-only query as empty", () => {
		expect(rankCommands(commands, "   ").map((c) => c.id)).toEqual(commands.map((c) => c.id));
	});

	it("filters to subsequence matches on the label", () => {
		const ranked = rankCommands(commands, "save");
		expect(ranked.map((c) => c.id)).toEqual(["save"]);
	});

	it("ranks a prefix/label hit above the rest", () => {
		const ranked = rankCommands(commands, "tab");
		expect(ranked[0]?.id).toBe("tab-next");
	});

	it("matches on keywords when the label does not match", () => {
		const ranked = rankCommands(commands, "remove");
		expect(ranked.map((c) => c.id)).toEqual(["close"]);
	});

	it("drops commands that match neither label nor keywords", () => {
		expect(rankCommands(commands, "zzzz")).toHaveLength(0);
	});

	it("prefers a label hit over a keyword-only hit of similar text", () => {
		const list = [cmd("a", "Format document"), cmd("b", "Wrap lines", ["format"])];
		const ranked = rankCommands(list, "format");
		expect(ranked[0]?.id).toBe("a");
	});

	it("breaks score ties toward the shorter label then input order", () => {
		const list = [cmd("long", "Close all tabs"), cmd("short", "Close tab")];
		const ranked = rankCommands(list, "close");
		expect(ranked.map((c) => c.id)).toEqual(["short", "long"]);
	});
});
