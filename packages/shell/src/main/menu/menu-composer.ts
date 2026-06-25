/**
 * Application-menu composer per docs/shell/33-windows-and-menus.md §Logical structure:
 *
 *   The menu is composed by the shell at runtime from three sources:
 *     1. Shell-owned items (Brainstorm > About / Settings / Quit; File > New Vault,
 *        Open Vault, Open Recent; standard Edit / View / Window / Help).
 *     2. Currently-focused-app items (from the focused app's manifest).
 *     3. Standard items (system roles: undo/redo/cut/copy/paste/...).
 *
 *   The menu order at the top level is shell-controlled:
 *     Brainstorm (macOS only) / File / Edit / View / <app-introduced menus
 *     in declaration order> / Window / Help.
 *
 * Pure function — input is (platform, focused-app menus + shortcuts) → output
 * is a typed `MenuTemplate`. The Electron `Menu.buildFromTemplate` wrapper
 * lives in `menu-installer.ts`; this file is fully unit-testable.
 *
 * Menu items + shortcut bindings share a namespace per docs/33 §Triggering —
 * a menu item with a shortcut binds the shortcut automatically, and a
 * shortcut rebinding updates the menu item's accelerator. The composer
 * accepts an `overrideAccelerator(itemId)` hook so the shortcut subsystem
 * can drive the displayed chord.
 */

import type {
	MenuItem as ManifestMenuItem,
	MenuRegistration,
	ShortcutRegistration,
} from "../apps/manifest";

export type Platform = "darwin" | "win32" | "linux";

export type MenuTemplateItem =
	| {
			kind: "click";
			id: string; // `<owner>/<menu-item-id>` — `shell/...` or `<app-id>/...`
			label: string;
			accelerator?: string;
			enabled?: boolean;
			submenu?: MenuTemplateItem[];
			payload?: { topicId?: string };
	  }
	| { kind: "separator" }
	| { kind: "role"; role: SystemRole; label?: string; accelerator?: string };

export type SystemRole =
	| "undo"
	| "redo"
	| "cut"
	| "copy"
	| "paste"
	| "pasteAndMatchStyle"
	| "delete"
	| "selectAll"
	| "minimize"
	| "zoom"
	| "togglefullscreen"
	| "front"
	| "close"
	| "quit"
	| "hide"
	| "hideOthers"
	| "unhide"
	| "about"
	| "services"
	| "reload"
	| "forceReload"
	| "toggleDevTools"
	| "resetZoom"
	| "zoomIn"
	| "zoomOut";

export type TopLevelMenu = {
	/** Display label for the menu (e.g. "File", "Edit", "Format"). */
	label: string;
	/** Source — controls ordering (shell goes first, app menus after View, system at end). */
	source: "brainstorm" | "file" | "edit" | "view" | "app" | "window" | "help";
	items: MenuTemplateItem[];
};

export type HelpSectionEntry = {
	sectionId: string;
	label: string;
	firstTopicId: string;
};

export type ComposeMenuOptions = {
	platform: Platform;
	/** Menus declared by the focused app's manifest (`manifest.menus`). When
	 *  null, no app is focused (the dashboard is) and only shell items show. */
	focusedAppMenus: readonly MenuRegistration[] | null;
	/** Focused app's id — used to namespace `id` fields on app-contributed clicks. */
	focusedAppId: string | null;
	/** Shortcuts declared by the focused app — used to fill in accelerators
	 *  on menu items that share an id with a shortcut. */
	focusedAppShortcuts?: readonly ShortcutRegistration[];
	/** Hook for the shortcut subsystem: given an item id (e.g. `<app-id>/save`),
	 *  return the user-rebound accelerator if any. Falls back to the manifest's
	 *  declared default. */
	overrideAccelerator?: (itemId: string) => string | null;
	/** Help corpus sections to expose under the Help menu — each opens the
	 *  overlay seeded with that section's first article. */
	helpSections?: readonly HelpSectionEntry[];
	/** Localized labels for shell menu entries. */
	labels?: Partial<ShellMenuLabels>;
};

export type ShellMenuLabels = {
	helpCenter: string;
	help: string;
};

const DEFAULT_LABELS: ShellMenuLabels = {
	helpCenter: "Help Center",
	help: "Brainstorm Help",
};

export type ComposedMenu = {
	menus: TopLevelMenu[];
};

/** Shell-owned File menu items (always present). */
function shellFileItems(platform: Platform): MenuTemplateItem[] {
	const items: MenuTemplateItem[] = [
		{ kind: "click", id: "shell/new-vault", label: "New Vault…" },
		{ kind: "click", id: "shell/open-vault", label: "Open Vault…", accelerator: "CmdOrCtrl+O" },
		{ kind: "click", id: "shell/open-recent", label: "Open Recent" },
		{ kind: "separator" },
		// New Tab opens a fresh tab in the focused app window. The strip's "+"
		// is hidden on single-tab windows, so this menu item + its accelerator
		// is the discoverable keyboard/mouse path. No-op when the dashboard or
		// no app window is focused.
		{ kind: "click", id: "shell/new-tab", label: "New Tab", accelerator: "CmdOrCtrl+T" },
		{ kind: "separator" },
		{
			kind: "role",
			role: "close",
			label: "Close Window",
			accelerator: "CmdOrCtrl+W",
		},
	];
	if (platform !== "darwin") {
		// macOS puts Quit under the Brainstorm menu.
		items.push({ kind: "separator" }, { kind: "role", role: "quit", label: "Quit" });
	}
	return items;
}

function shellEditItems(): MenuTemplateItem[] {
	return [
		{ kind: "role", role: "undo" },
		{ kind: "role", role: "redo" },
		{ kind: "separator" },
		{ kind: "role", role: "cut" },
		{ kind: "role", role: "copy" },
		{ kind: "role", role: "paste" },
		{ kind: "role", role: "pasteAndMatchStyle" },
		{ kind: "role", role: "delete" },
		{ kind: "separator" },
		{ kind: "role", role: "selectAll" },
	];
}

function shellViewItems(platform: Platform): MenuTemplateItem[] {
	// `toggleDevTools` ships as a click handler rather than the Electron
	// `role:` because Electron 41's internal `_executeCommand` for that
	// role throws `getAllWebContents is not a function …` when invoked from
	// an app window — the shell-side click handler in `menu-setup.ts`
	// drives `BrowserWindow.getFocusedWindow().webContents.toggleDevTools()`
	// directly and sidesteps the broken role dispatcher. Reload / zoom roles
	// share the same internal path but haven't been observed broken yet —
	// migrate them the same way if they hit it.
	const devToolsAccel = platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I";
	return [
		{ kind: "role", role: "reload" },
		{ kind: "role", role: "forceReload" },
		{
			kind: "click",
			id: "shell/toggle-devtools",
			label: "Toggle Developer Tools",
			accelerator: devToolsAccel,
		},
		{ kind: "separator" },
		{ kind: "role", role: "resetZoom" },
		{ kind: "role", role: "zoomIn" },
		{ kind: "role", role: "zoomOut" },
		{ kind: "separator" },
		{ kind: "role", role: "togglefullscreen", label: "Toggle Full Screen" },
	];
}

function shellWindowItems(platform: Platform): MenuTemplateItem[] {
	const items: MenuTemplateItem[] = [
		{ kind: "role", role: "minimize" },
		{ kind: "role", role: "zoom" },
	];
	if (platform === "darwin") {
		items.push({ kind: "separator" }, { kind: "role", role: "front", label: "Bring All to Front" });
	}
	return items;
}

function shellHelpItems(
	helpSections: readonly HelpSectionEntry[] | undefined,
	labels: ShellMenuLabels,
): MenuTemplateItem[] {
	const items: MenuTemplateItem[] = [{ kind: "click", id: "shell/help", label: labels.helpCenter }];
	if (helpSections && helpSections.length > 0) {
		items.push({ kind: "separator" });
		for (const section of helpSections) {
			items.push({
				kind: "click",
				id: `shell/help.section.${section.sectionId}`,
				label: section.label,
				payload: { topicId: section.firstTopicId },
			});
		}
	}
	return items;
}

function macAppMenuItems(): MenuTemplateItem[] {
	return [
		{ kind: "role", role: "about", label: "About Brainstorm" },
		{ kind: "separator" },
		{ kind: "click", id: "shell/settings", label: "Settings…", accelerator: "Cmd+," },
		{ kind: "separator" },
		{ kind: "role", role: "services", label: "Services" },
		{ kind: "separator" },
		{ kind: "role", role: "hide", label: "Hide Brainstorm" },
		{ kind: "role", role: "hideOthers", label: "Hide Others" },
		{ kind: "role", role: "unhide", label: "Show All" },
		{ kind: "separator" },
		{ kind: "role", role: "quit", label: "Quit Brainstorm" },
	];
}

/**
 * Compose the full menu. Returns an ordered list of top-level menus per
 * docs/33 §Logical structure.
 */
export function composeMenu(options: ComposeMenuOptions): ComposedMenu {
	const menus: TopLevelMenu[] = [];

	if (options.platform === "darwin") {
		menus.push({ label: "Brainstorm", source: "brainstorm", items: macAppMenuItems() });
	}

	menus.push({ label: "File", source: "file", items: shellFileItems(options.platform) });
	menus.push({ label: "Edit", source: "edit", items: shellEditItems() });
	menus.push({ label: "View", source: "view", items: shellViewItems(options.platform) });

	// App-contributed menus (excluding File/Edit/View/Window/Help which the
	// shell owns; app additions to those land via dedicated registration in a
	// future iteration if needed). For Stage 6 we slot app menus straight into
	// new top-level positions after View per docs/33.
	if (options.focusedAppMenus && options.focusedAppId) {
		const shellOwnedLabels = new Set(["File", "Edit", "View", "Window", "Help", "Brainstorm"]);
		for (const m of options.focusedAppMenus) {
			if (shellOwnedLabels.has(m.menu)) continue;
			menus.push({
				label: m.menu,
				source: "app",
				items: toTemplateItems(
					m.items,
					options.focusedAppId,
					options.focusedAppShortcuts ?? [],
					options.overrideAccelerator,
				),
			});
		}
	}

	menus.push({ label: "Window", source: "window", items: shellWindowItems(options.platform) });
	const labels: ShellMenuLabels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
	menus.push({
		label: "Help",
		source: "help",
		items: shellHelpItems(options.helpSections, labels),
	});

	return { menus };
}

function toTemplateItems(
	items: readonly ManifestMenuItem[],
	appId: string,
	shortcuts: readonly ShortcutRegistration[],
	overrideAccelerator?: (itemId: string) => string | null,
): MenuTemplateItem[] {
	const shortcutById = new Map<string, string>();
	for (const s of shortcuts) shortcutById.set(s.id, s.default);

	return items.map((item) => {
		if ("type" in item) {
			if (item.type === "separator") return { kind: "separator" };
			return { kind: "role", role: item.role as SystemRole };
		}
		const namespacedId = `${appId}/${item.id}`;
		const explicit = item.shortcut;
		const fromShortcut = shortcutById.get(item.id);
		const override = overrideAccelerator?.(namespacedId);
		const accelerator = override ?? explicit ?? fromShortcut;
		return {
			kind: "click",
			id: namespacedId,
			label: item.label,
			...(accelerator ? { accelerator } : {}),
		};
	});
}

/**
 * Resolve a menu-item click. Returns `{ owner, action }` where `owner` is
 * `"shell"` or the `<app-id>` and `action` is the local id (`new-vault`,
 * `save`, etc.).
 */
export function resolveMenuItemId(id: string): { owner: string; action: string } | null {
	const slash = id.indexOf("/");
	if (slash < 0) return null;
	return { owner: id.slice(0, slash), action: id.slice(slash + 1) };
}
