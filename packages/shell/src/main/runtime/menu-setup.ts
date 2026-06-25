/**
 * Stage 5b — wires the Stage 6 menu modules into the running shell.
 *
 *   - Constructs the MenuInstaller (Electron Menu wrapper) and a MenuRouter.
 *   - Registers shell-side handlers for File / Brainstorm-menu actions.
 *   - Forwards user-visible shell actions to the dashboard renderer via the
 *     trusted `shell:action` channel — the renderer's Dashboard component
 *     opens the Settings overlay, dispatches the New Vault flow, etc.
 *   - Forwards app-targeted clicks to the focused app's renderer via the
 *     private `menu:invoke` channel (the same channel docs/33 calls out).
 *
 * Pure orchestration — every external dependency is injected so the file
 * is testable without an Electron app context.
 */

import { type WebContents, app, webContents } from "electron";
import type { Platform } from "../menu/menu-composer";
import { MENU_INVOKE_CHANNEL, MenuRouter } from "../menu/menu-dispatch";
import { MenuInstaller } from "../menu/menu-installer";

export const SHELL_ACTION_CHANNEL = "shell:action" as const;

export type DashboardSender = {
	send(channel: string, payload: { action: string; topicId?: string }): void;
};

export type FocusedAppSender = (appId: string, payload: { action: string }) => void;

export type MenuSetup = {
	installer: MenuInstaller;
	router: MenuRouter;
};

export type MenuSetupOptions = {
	platform?: Platform;
	getDashboard: () => DashboardSender | null;
	sendToFocusedApp?: FocusedAppSender;
	/** Resolve the container + app id owning a focused webContents (the
	 *  "New Tab" action targets the focused app window). `senderId` is the app
	 *  RENDERER to route tab commands to — equal to the input for a tab
	 *  renderer, the owning chrome tab when focus rests on a Browser page
	 *  `WebContentsView` (which is not an app tab itself). */
	resolveFocusedTab?: (
		webContentsId: number,
	) => { containerId: string; appId: string; senderId: number } | null;
	/** Open a fresh tab in the given container (→ orchestrator.addTab). */
	openFreshTab?: (containerId: string, appId: string) => void;
	/** Give a self-tabbing app (the Browser) first refusal on New Tab: forward
	 *  the command to the resolved renderer (`senderId`) instead of adding a
	 *  window-container tab. Returns true when it handled it (skip
	 *  {@link openFreshTab}). */
	routeNewTabToApp?: (senderId: number, appId: string) => boolean;
	/** If `webContentsId` is a tab-strip chrome view, return the webContents id
	 *  of its container's active app tab — else null. Lets Toggle-DevTools fall
	 *  through to the app renderer instead of the (DevTools-disabled) strip when
	 *  focus rests on the strip. */
	resolveActiveTabForChrome?: (webContentsId: number) => number | null;
};

/** Forwarder that posts an app-action to a renderer's `menu:invoke` channel. */
export function sendToWebContents(target: WebContents): (payload: { action: string }) => void {
	return (payload) => {
		target.send(MENU_INVOKE_CHANNEL, payload);
	};
}

/**
 * Build the menu setup. Default shell handlers cover Quit, Settings, New
 * Vault, Open Vault, Help — anything UI-side asks the dashboard to handle
 * via `shell:action`.
 */
export function createMenuSetup(options: MenuSetupOptions): MenuSetup {
	const platform: Platform = options.platform ?? (process.platform as Platform);
	const sendToFocusedApp: FocusedAppSender =
		options.sendToFocusedApp ??
		(() => {
			// Stage 6 / 7 wire the real per-app dispatch via the launcher. Until
			// any app exists, app-targeted clicks have nowhere to land — log so
			// the dropped event is visible during development.
			console.warn("[brainstorm] menu click for unfocused app dropped — no sender wired");
		});
	const router = new MenuRouter(sendToFocusedApp);

	const forward = (action: string) => (_action?: string, payload?: { topicId?: string }) => {
		const dashboard = options.getDashboard();
		if (!dashboard) {
			console.warn(`[brainstorm] shell action '${action}' has no dashboard target`);
			return;
		}
		dashboard.send(SHELL_ACTION_CHANNEL, {
			action,
			...(payload?.topicId ? { topicId: payload.topicId } : {}),
		});
	};

	router.registerShellHandler("quit", () => {
		app.quit();
	});
	router.registerShellHandler("settings", forward("settings"));
	router.registerShellHandler("new-vault", forward("new-vault"));
	router.registerShellHandler("open-vault", forward("open-vault"));
	router.registerShellHandler("open-recent", forward("open-recent"));
	router.registerShellHandler("help", forward("help"));
	// Bypass Electron 41's broken `role:"toggleDevTools"` dispatch (which
	// throws inside `_executeCommand` → `getFocusedWebContents`). Drive the
	// focused webContents' DevTools directly. We resolve the *webContents*
	// (not the window) because app windows are now `BaseWindow` + per-tab
	// `WebContentsView` — `BrowserWindow.getFocusedWindow()` returns null for
	// them, so the old window-based lookup silently no-op'd the shortcut.
	router.registerShellHandler("toggle-devtools", () => {
		const focused = webContents.getFocusedWebContents();
		if (!focused) return;
		// The tab strip disables DevTools, so when it holds focus the toggle
		// would no-op. Redirect to its container's active app tab instead.
		const redirectId = options.resolveActiveTabForChrome?.(focused.id) ?? null;
		const target = redirectId !== null ? (webContents.fromId(redirectId) ?? focused) : focused;
		target.toggleDevTools();
	});
	// New Tab — open a fresh tab in the focused app window. The focused
	// webContents is the active tab's view; map it to its container and ask the
	// orchestrator to add a tab. A no-op when the focused surface isn't an app
	// tab (dashboard, settings) so Cmd+T there does nothing.
	router.registerShellHandler("new-tab", () => {
		const focused = webContents.getFocusedWebContents();
		if (!focused) return;
		const hit = options.resolveFocusedTab?.(focused.id);
		if (!hit) return;
		if (options.routeNewTabToApp?.(hit.senderId, hit.appId)) return;
		options.openFreshTab?.(hit.containerId, hit.appId);
	});

	const installer = new MenuInstaller({ platform, router });
	return { installer, router };
}
