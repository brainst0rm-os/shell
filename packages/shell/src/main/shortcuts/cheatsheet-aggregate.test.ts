import { describe, expect, it } from "vitest";
import { aggregateCheatsheet } from "./cheatsheet-aggregate";
import { ShortcutRegistry } from "./shortcut-registry";

function setup(): ShortcutRegistry {
	const reg = new ShortcutRegistry();
	reg.registerShell();
	reg.registerApp("io.example.notes", [
		{ id: "save", default: "Mod+S", label: "Save" }, // window-default
		{ id: "format-bold", default: "Mod+B", label: "Bold", scope: "editor" },
		{ id: "comment", default: "Mod+Alt+C", label: "Comment on selection", scope: "selection" },
		{ id: "outline-toggle", default: "Mod+Shift+O", label: "Toggle outline", scope: "window" },
	]);
	reg.registerApp("io.example.other", [{ id: "save", default: "Mod+S", label: "Other Save" }]);
	return reg;
}

describe("aggregateCheatsheet (6.10c)", () => {
	it("with no focused app, includes only shell bindings", () => {
		const reg = setup();
		const result = aggregateCheatsheet(reg, { focusedAppId: null });
		for (const b of result) {
			expect(b.action.layer).toBe("shell");
		}
		// Sanity: it included the well-known shell defaults.
		expect(result.find((b) => b.action.id === "shell/launcher")).toBeDefined();
	});

	it("with focused app + no active scope, includes shell + every binding of that app", () => {
		const reg = setup();
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).toContain("shell/launcher");
		expect(ids).toContain("io.example.notes/save");
		expect(ids).toContain("io.example.notes/format-bold");
		expect(ids).toContain("io.example.notes/comment");
		expect(ids).toContain("io.example.notes/outline-toggle");
		// Other app's bindings are NOT included.
		expect(ids).not.toContain("io.example.other/save");
	});

	it("when an active scope is reported, app bindings filter by it (window + matching narrow)", () => {
		const reg = setup();
		reg.setActiveScope("io.example.notes", "editor");
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).toContain("io.example.notes/save"); // scope undefined → window-default
		expect(ids).toContain("io.example.notes/outline-toggle"); // scope "window"
		expect(ids).toContain("io.example.notes/format-bold"); // matches "editor"
		expect(ids).not.toContain("io.example.notes/comment"); // scope "selection" — excluded
	});

	it("an unmatched custom active scope drops every narrow-scoped binding but keeps window+default", () => {
		const reg = setup();
		reg.setActiveScope("io.example.notes", "no-such-scope");
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).toContain("io.example.notes/save");
		expect(ids).toContain("io.example.notes/outline-toggle");
		expect(ids).not.toContain("io.example.notes/format-bold");
		expect(ids).not.toContain("io.example.notes/comment");
	});

	it("setActiveScope(null) clears the narrow filter (every app binding is back)", () => {
		const reg = setup();
		reg.setActiveScope("io.example.notes", "editor");
		reg.setActiveScope("io.example.notes", null);
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).toContain("io.example.notes/format-bold");
		expect(ids).toContain("io.example.notes/comment");
	});

	it("a dynamic shortcut for the focused app is included alongside static", () => {
		const reg = setup();
		reg.registerAppDynamic("io.example.notes", [
			{ id: "find-next", default: "Mod+G", label: "Find Next", scope: "editor" },
		]);
		reg.setActiveScope("io.example.notes", "editor");
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).toContain("io.example.notes/find-next");
	});

	it("dynamic bindings of an unfocused app are excluded", () => {
		const reg = setup();
		reg.registerAppDynamic("io.example.other", [{ id: "dyn", default: "Mod+H", label: "Dyn" }]);
		const result = aggregateCheatsheet(reg, { focusedAppId: "io.example.notes" });
		const ids = result.map((b) => b.action.id);
		expect(ids).not.toContain("io.example.other/dyn");
	});
});
