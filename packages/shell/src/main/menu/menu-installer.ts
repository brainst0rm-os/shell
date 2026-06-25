/**
 * Menu installer — the Electron-facing wrapper that turns the pure
 * `composeMenu()` output into a real application menu via Electron's
 * `Menu.buildFromTemplate` + `Menu.setApplicationMenu`.
 *
 * Per docs/shell/33-windows-and-menus.md §Logical structure, the menu is
 * recomposed on focus change. This file owns the recomposition trigger and
 * the click dispatch; the pure composer lives in `menu-composer.ts`.
 *
 * Stage 5b lands the wrapper. Recomposition on focus change wires in when
 * apps are launched (Stage 7's WindowManager handles `focus` events and
 * calls back into this installer's `update(focusedAppId, ...)`).
 */

import { Menu, type MenuItemConstructorOptions } from "electron";
import {
	type ComposeMenuOptions,
	type ComposedMenu,
	type MenuTemplateItem,
	type Platform,
	type SystemRole,
	composeMenu,
} from "./menu-composer";
import type { MenuRouter } from "./menu-dispatch";

export type MenuInstallerOptions = {
	platform: Platform;
	router: MenuRouter;
};

export class MenuInstaller {
	private readonly platform: Platform;
	private readonly router: MenuRouter;
	private current: ComposedMenu | null = null;

	constructor(options: MenuInstallerOptions) {
		this.platform = options.platform;
		this.router = options.router;
	}

	/** Recompose + install. Pass the active focused-app context (null when
	 *  the dashboard is focused or no app is). */
	install(context: Omit<ComposeMenuOptions, "platform">): ComposedMenu {
		this.current = composeMenu({ platform: this.platform, ...context });
		const template = this.current.menus.map((m) => this.toElectronMenu(m));
		const built = Menu.buildFromTemplate(template);
		Menu.setApplicationMenu(built);
		return this.current;
	}

	/** Convenience: install the dashboard-only menu (no app focused). */
	installDashboard(): ComposedMenu {
		return this.install({ focusedAppMenus: null, focusedAppId: null });
	}

	currentMenu(): ComposedMenu | null {
		return this.current;
	}

	/** Pure-data conversion from our composer output to an Electron template.
	 *  Click handlers route through `router.dispatch(itemId)` — the shell
	 *  identity drives shell items; app ids route to the focused renderer. */
	private toElectronMenu(menu: ComposedMenu["menus"][number]): MenuItemConstructorOptions {
		return {
			label: menu.label,
			submenu: menu.items.map((item) => this.toElectronItem(item)),
		};
	}

	private toElectronItem(item: MenuTemplateItem): MenuItemConstructorOptions {
		if (item.kind === "separator") {
			return { type: "separator" };
		}
		if (item.kind === "role") {
			const out: MenuItemConstructorOptions = { role: item.role as SystemRole };
			if (item.label !== undefined) out.label = item.label;
			if (item.accelerator !== undefined) out.accelerator = item.accelerator;
			return out;
		}
		const out: MenuItemConstructorOptions = {
			label: item.label,
			click: () => {
				void this.router.dispatch(item.id, item.payload);
			},
		};
		if (item.accelerator !== undefined) out.accelerator = item.accelerator;
		if (item.submenu) {
			out.submenu = item.submenu.map((sub) => this.toElectronItem(sub));
		}
		if (item.enabled === false) out.enabled = false;
		return out;
	}
}
