import { describe, expect, it, vi } from "vitest";
import { SHELL_ACTION_CHANNEL, createMenuSetup } from "./menu-setup";

// Vitest under Bun can't resolve Electron's runtime exports; stub the pieces
// our tests touch (`app.quit`, `Menu.buildFromTemplate`, `Menu.setApplicationMenu`).
vi.mock("electron", () => ({
	app: { quit: vi.fn() },
	Menu: {
		buildFromTemplate: vi.fn((template) => ({ items: template })),
		setApplicationMenu: vi.fn(),
	},
	webContents: { getFocusedWebContents: vi.fn(() => null), fromId: vi.fn(() => null) },
}));

function fakeDashboard() {
	const posts: Array<{ channel: string; payload: unknown }> = [];
	const dashboard = {
		send: (channel: string, payload: { action: string }) => {
			posts.push({ channel, payload });
		},
	};
	return { dashboard, posts };
}

describe("createMenuSetup", () => {
	it("forwards Settings clicks to the dashboard via shell:action", async () => {
		const { dashboard, posts } = fakeDashboard();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
		});
		await setup.router.dispatch("shell/settings");
		expect(posts).toEqual([{ channel: SHELL_ACTION_CHANNEL, payload: { action: "settings" } }]);
	});

	it("forwards New Vault / Open Vault / Open Recent / Help via shell:action", async () => {
		const { dashboard, posts } = fakeDashboard();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
		});
		for (const id of ["shell/new-vault", "shell/open-vault", "shell/open-recent", "shell/help"]) {
			await setup.router.dispatch(id);
		}
		expect(posts.map((p) => p.payload)).toEqual([
			{ action: "new-vault" },
			{ action: "open-vault" },
			{ action: "open-recent" },
			{ action: "help" },
		]);
	});

	it("New Tab opens a fresh tab in the focused app's container", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({ id: 42 } as never);
		const openFreshTab = vi.fn();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveFocusedTab: (id) =>
				id === 42 ? { containerId: "c1", appId: "io.example.notes", senderId: id } : null,
			openFreshTab,
		});
		await setup.router.dispatch("shell/new-tab");
		expect(openFreshTab).toHaveBeenCalledWith("c1", "io.example.notes");
	});

	it("New Tab routes to a self-tabbing app instead of its container", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({ id: 42 } as never);
		const openFreshTab = vi.fn();
		const routeNewTabToApp = vi.fn((id: number, appId: string) => appId === "io.brainstorm.browser");
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveFocusedTab: (id) =>
				id === 42 ? { containerId: "c1", appId: "io.brainstorm.browser", senderId: id } : null,
			openFreshTab,
			routeNewTabToApp,
		});
		await setup.router.dispatch("shell/new-tab");
		expect(routeNewTabToApp).toHaveBeenCalledWith(42, "io.brainstorm.browser");
		expect(openFreshTab).not.toHaveBeenCalled();
	});

	it("New Tab routes through the resolved sender when focus rests on a page view", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		// Focus is on a Browser page WebContentsView (id 77) — not an app tab.
		// The resolver maps it to its owning chrome tab (id 42).
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({ id: 77 } as never);
		const openFreshTab = vi.fn();
		const routeNewTabToApp = vi.fn(() => true);
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveFocusedTab: (id) =>
				id === 77 ? { containerId: "c1", appId: "io.brainstorm.browser", senderId: 42 } : null,
			openFreshTab,
			routeNewTabToApp,
		});
		await setup.router.dispatch("shell/new-tab");
		expect(routeNewTabToApp).toHaveBeenCalledWith(42, "io.brainstorm.browser");
		expect(openFreshTab).not.toHaveBeenCalled();
	});

	it("New Tab falls back to the container when the app declines routing", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({ id: 42 } as never);
		const openFreshTab = vi.fn();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveFocusedTab: (id) =>
				id === 42 ? { containerId: "c1", appId: "io.example.notes", senderId: id } : null,
			openFreshTab,
			routeNewTabToApp: () => false,
		});
		await setup.router.dispatch("shell/new-tab");
		expect(openFreshTab).toHaveBeenCalledWith("c1", "io.example.notes");
	});

	it("New Tab is a no-op when the focused surface isn't an app tab", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue(null);
		const openFreshTab = vi.fn();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveFocusedTab: () => null,
			openFreshTab,
		});
		await setup.router.dispatch("shell/new-tab");
		expect(openFreshTab).not.toHaveBeenCalled();
	});

	it("Toggle DevTools toggles the focused app tab directly", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		const toggleDevTools = vi.fn();
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({
			id: 7,
			toggleDevTools,
		} as never);
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			// id 7 is a normal app tab, not a chrome strip.
			resolveActiveTabForChrome: () => null,
		});
		await setup.router.dispatch("shell/toggle-devtools");
		expect(toggleDevTools).toHaveBeenCalled();
	});

	it("Toggle DevTools redirects to the active app tab when the strip holds focus", async () => {
		const { dashboard } = fakeDashboard();
		const { webContents } = await import("electron");
		const stripToggle = vi.fn();
		const tabToggle = vi.fn();
		// Focus is on the chrome strip (id 99); its container's active tab is id 5.
		vi.spyOn(webContents, "getFocusedWebContents").mockReturnValue({
			id: 99,
			toggleDevTools: stripToggle,
		} as never);
		vi.spyOn(webContents, "fromId").mockReturnValue({ id: 5, toggleDevTools: tabToggle } as never);
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			resolveActiveTabForChrome: (id) => (id === 99 ? 5 : null),
		});
		await setup.router.dispatch("shell/toggle-devtools");
		expect(tabToggle).toHaveBeenCalled();
		expect(stripToggle).not.toHaveBeenCalled();
	});

	it("Quit calls app.quit()", async () => {
		const { dashboard } = fakeDashboard();
		const { app } = await import("electron");
		const spy = vi.spyOn(app, "quit").mockImplementation(() => undefined);
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
		});
		await setup.router.dispatch("shell/quit");
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("logs a warning when a shell action fires with no dashboard attached", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => null,
		});
		await setup.router.dispatch("shell/settings");
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("unknown app ids fire the focused-app sender", async () => {
		const sendToFocusedApp = vi.fn();
		const { dashboard } = fakeDashboard();
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => dashboard,
			sendToFocusedApp,
		});
		await setup.router.dispatch("io.example.editor/save");
		expect(sendToFocusedApp).toHaveBeenCalledWith("io.example.editor", { action: "save" });
	});

	it("installer.installDashboard composes a sensible top-level menu", () => {
		const setup = createMenuSetup({
			platform: "darwin",
			getDashboard: () => null,
		});
		// installDashboard calls Menu.buildFromTemplate / setApplicationMenu —
		// under Vitest we have a shim, but we don't actually need the side
		// effect to run. Just confirm the composer output:
		const composed = setup.installer.installDashboard();
		expect(composed.menus[0]?.label).toBe("Brainstorm");
		expect(composed.menus.find((m) => m.label === "File")).toBeDefined();
	});
});
