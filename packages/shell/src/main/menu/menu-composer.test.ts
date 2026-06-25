import { describe, expect, it } from "vitest";
import type { MenuRegistration, ShortcutRegistration } from "../apps/manifest";
import { composeMenu, resolveMenuItemId } from "./menu-composer";

function topLevelLabels(menus: ReturnType<typeof composeMenu>): string[] {
	return menus.menus.map((m) => m.label);
}

describe("composeMenu", () => {
	it("emits Brainstorm / File / Edit / View / Window / Help on macOS with no app focused", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: null,
			focusedAppId: null,
		});
		expect(topLevelLabels(result)).toEqual(["Brainstorm", "File", "Edit", "View", "Window", "Help"]);
	});

	it("omits the Brainstorm menu on Windows / Linux", () => {
		const win = composeMenu({ platform: "win32", focusedAppMenus: null, focusedAppId: null });
		expect(topLevelLabels(win)[0]).toBe("File");
		const lin = composeMenu({ platform: "linux", focusedAppMenus: null, focusedAppId: null });
		expect(topLevelLabels(lin)[0]).toBe("File");
	});

	it("includes Quit under File on non-macOS, omits it on macOS", () => {
		const mac = composeMenu({ platform: "darwin", focusedAppMenus: null, focusedAppId: null });
		const macFile = mac.menus.find((m) => m.label === "File");
		const quitsOnMac = macFile?.items.filter((i) => i.kind === "role" && i.role === "quit");
		expect(quitsOnMac).toEqual([]);

		const win = composeMenu({ platform: "win32", focusedAppMenus: null, focusedAppId: null });
		const winFile = win.menus.find((m) => m.label === "File");
		const quits = winFile?.items.filter((i) => i.kind === "role" && i.role === "quit");
		expect(quits?.length).toBe(1);
	});

	it("inserts app-introduced menus between View and Window in declaration order", () => {
		const appMenus: MenuRegistration[] = [
			{ menu: "Format", items: [{ id: "bold", label: "Bold" }] },
			{ menu: "Tools", items: [{ id: "spell", label: "Spell Check" }] },
		];
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: appMenus,
			focusedAppId: "io.example.editor",
		});
		expect(topLevelLabels(result)).toEqual([
			"Brainstorm",
			"File",
			"Edit",
			"View",
			"Format",
			"Tools",
			"Window",
			"Help",
		]);
	});

	it("does NOT allow apps to override shell-owned top-level menus", () => {
		const appMenus: MenuRegistration[] = [
			{ menu: "File", items: [{ id: "save", label: "Save" }] },
			{ menu: "Help", items: [{ id: "doc", label: "Docs" }] },
		];
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: appMenus,
			focusedAppId: "io.example.editor",
		});
		const fileMenu = result.menus.find((m) => m.label === "File");
		const fileIds = fileMenu?.items
			.filter((i) => i.kind === "click")
			.map((i) => (i.kind === "click" ? i.id : ""));
		expect(fileIds?.every((id) => id.startsWith("shell/"))).toBe(true);
	});

	it("namespaces app-menu item ids by `<app-id>/<item-id>`", () => {
		const appMenus: MenuRegistration[] = [{ menu: "Format", items: [{ id: "bold", label: "Bold" }] }];
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: appMenus,
			focusedAppId: "io.example.editor",
		});
		const format = result.menus.find((m) => m.label === "Format");
		const ids = format?.items
			.filter((i) => i.kind === "click")
			.map((i) => (i.kind === "click" ? i.id : ""));
		expect(ids).toEqual(["io.example.editor/bold"]);
	});

	it("fills in accelerators from a shortcut registration when the manifest item omits one", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: [{ menu: "Format", items: [{ id: "bold", label: "Bold" }] }],
			focusedAppId: "io.example.editor",
			focusedAppShortcuts: [{ id: "bold", default: "CmdOrCtrl+B", label: "Bold" }],
		});
		const format = result.menus.find((m) => m.label === "Format");
		const bold = format?.items.find((i) => i.kind === "click");
		expect(bold?.kind === "click" && bold.accelerator).toBe("CmdOrCtrl+B");
	});

	it("respects overrideAccelerator (user rebinding) over both manifest + shortcut defaults", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: [
				{ menu: "Format", items: [{ id: "bold", label: "Bold", shortcut: "CmdOrCtrl+B" }] },
			],
			focusedAppId: "io.example.editor",
			focusedAppShortcuts: [{ id: "bold", default: "CmdOrCtrl+B", label: "Bold" }],
			overrideAccelerator: (id) => (id === "io.example.editor/bold" ? "Alt+B" : null),
		});
		const format = result.menus.find((m) => m.label === "Format");
		const bold = format?.items.find((i) => i.kind === "click");
		expect(bold?.kind === "click" && bold.accelerator).toBe("Alt+B");
	});

	it("preserves separator and system role items from the manifest", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: [
				{
					menu: "Format",
					items: [
						{ id: "bold", label: "Bold" },
						{ type: "separator" },
						{ type: "system", role: "selectAll" },
					],
				},
			],
			focusedAppId: "io.example.editor",
		});
		const format = result.menus.find((m) => m.label === "Format");
		expect(format?.items.length).toBe(3);
		expect(format?.items[1]).toEqual({ kind: "separator" });
		expect(format?.items[2]).toMatchObject({ kind: "role", role: "selectAll" });
	});

	it("when no app is focused, falls through to shell-only menu (no app top-level menus)", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: null,
			focusedAppId: null,
		});
		const sources = result.menus.map((m) => m.source);
		expect(sources).not.toContain("app");
	});

	it("emits Help submenu with one item per helpSection plus the Help Center entry", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: null,
			focusedAppId: null,
			helpSections: [
				{ sectionId: "getting-started", label: "Getting started", firstTopicId: "guide/x" },
				{ sectionId: "app-notes", label: "Notes", firstTopicId: "app/io.brainstorm.notes/y" },
			],
		});
		const help = result.menus.find((m) => m.label === "Help");
		expect(help).toBeDefined();
		const items = help?.items ?? [];
		expect(items[0]).toMatchObject({ kind: "click", id: "shell/help" });
		expect(items[1]).toMatchObject({ kind: "separator" });
		expect(items[2]).toMatchObject({
			kind: "click",
			id: "shell/help.section.getting-started",
			label: "Getting started",
			payload: { topicId: "guide/x" },
		});
		expect(items[3]).toMatchObject({
			kind: "click",
			id: "shell/help.section.app-notes",
			label: "Notes",
			payload: { topicId: "app/io.brainstorm.notes/y" },
		});
	});

	it("omits the section list when no helpSections are passed", () => {
		const result = composeMenu({
			platform: "darwin",
			focusedAppMenus: null,
			focusedAppId: null,
		});
		const help = result.menus.find((m) => m.label === "Help");
		expect(help?.items.length).toBe(1);
	});
});

describe("resolveMenuItemId", () => {
	it("splits owner from action", () => {
		expect(resolveMenuItemId("shell/new-vault")).toEqual({
			owner: "shell",
			action: "new-vault",
		});
		expect(resolveMenuItemId("io.example.editor/save")).toEqual({
			owner: "io.example.editor",
			action: "save",
		});
	});

	it("returns null for malformed ids", () => {
		expect(resolveMenuItemId("save")).toBeNull();
		expect(resolveMenuItemId("")).toBeNull();
	});

	it("only splits on the first slash (preserves the rest in the action)", () => {
		expect(resolveMenuItemId("io.example/Note/v1")).toEqual({
			owner: "io.example",
			action: "Note/v1",
		});
	});
});
