/**
 * Per-app visual states. Each state declares an optional `setup(page)` that
 * runs after the app window's first paint; the harness screenshots the page
 * once setup resolves.
 *
 * Defaults are conservative — every app starts with a single `"default"`
 * state (launch + ready). Apps grow their own states as the visual surface
 * matures; the per-app team adds entries here when a meaningful state isn't
 * the default landing view.
 *
 * Surface kinds:
 *   - `"app"`   — a sandboxed app window. Launched via the dashboard's
 *                 `brainstorm.apps.launch(appId)`; setup runs in the app
 *                 page's context.
 *   - `"shell"` — the dashboard renderer itself (or one of its overlays).
 *                 Setup runs in the dashboard page; no app window opens.
 */

import type { Page } from "@playwright/test";

export type VisualSurfaceKind = "app" | "shell";

export type VisualState = {
	name: string;
	setup?: (page: Page) => Promise<void>;
};

export type AppVisualSpec = {
	kind: "app";
	appId: string;
	label: string;
	states: ReadonlyArray<VisualState>;
};

export type ShellVisualSpec = {
	kind: "shell";
	id: string;
	label: string;
	states: ReadonlyArray<VisualState>;
};

export type VisualSpec = AppVisualSpec | ShellVisualSpec;

async function clickByTestId(page: Page, id: string): Promise<void> {
	await page.locator(`[data-testid="${id}"]`).first().click({ timeout: 5_000 });
	await page.waitForTimeout(150);
}

/** Close the first-boot changelog popover (and any other `<Popover>`) — its
 *  backdrop intercepts every click on the dashboard. Escape doesn't close it,
 *  so click the backdrop's corner (its centre is covered by the dialog). */
async function dismissOverlays(page: Page): Promise<void> {
	await page
		.locator(".popover__backdrop")
		.first()
		.click({ timeout: 2_000, position: { x: 10, y: 10 } })
		.catch(() => {});
	await page.keyboard.press("Escape");
	await page.waitForTimeout(150);
}

export const APP_SPECS: ReadonlyArray<AppVisualSpec> = [
	{
		kind: "app",
		appId: "io.brainstorm.notes",
		label: "Notes",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.files",
		label: "Files",
		states: [
			{ name: "list" },
			{
				name: "grid",
				setup: (page) => clickByTestId(page, "view-switch-grid"),
			},
			{
				name: "gallery",
				setup: (page) => clickByTestId(page, "view-switch-gallery"),
			},
		],
	},
	{
		kind: "app",
		appId: "io.brainstorm.database",
		label: "Database",
		states: [
			{ name: "default" },
			{
				name: "settings-root",
				setup: async (page) => {
					await page.locator("#toolbar-settings").click({ timeout: 5_000 });
					await page.locator(".db-popover").waitFor({ timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
			{
				name: "settings-view-type",
				setup: async (page) => {
					await page.locator("#toolbar-settings").click({ timeout: 5_000 });
					await page.locator(".db-popover").waitFor({ timeout: 5_000 });
					await page.locator(".db-popover__nav-row").first().click({ timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
			{
				name: "filter-pills",
				setup: async (page) => {
					// The fancy-menus runtime renders rows as `role="option"`; the empty
					// funnel now opens the property list directly (no "Add rule" wrapper),
					// and each submenu opens a frame after its parent row, so settle.
					await page.locator("#toolbar-filter").click({ timeout: 5_000 });
					await page.waitForTimeout(250);
					await page.getByRole("option", { name: "Name", exact: true }).click({ timeout: 5_000 });
					await page.waitForTimeout(250);
					// A value-less operator so the pill commits without a prompt.
					await page.getByRole("option", { name: "is set", exact: true }).click({ timeout: 5_000 });
					await page.locator(".db-filter-bar .db-pill--filter").first().waitFor({ timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
			{
				name: "filter-value-prompt",
				setup: async (page) => {
					// Drive to the labelled value popover (property + operator that needs
					// a value) — shows the "Name contains" titled input. Order-independent:
					// an empty funnel opens the property list directly, while a view that
					// already carries a filter (from an earlier capture) shows the manager,
					// so drill via "Add another rule" when it's present.
					await page.locator("#toolbar-filter").click({ timeout: 5_000 });
					await page.waitForTimeout(250);
					const addRule = page.getByRole("option", { name: /Add (another rule|filter rule)/ });
					if (await addRule.count()) {
						await addRule.first().click({ timeout: 5_000 });
						await page.waitForTimeout(250);
					}
					await page.getByRole("option", { name: "Name", exact: true }).click({ timeout: 5_000 });
					await page.waitForTimeout(250);
					await page.getByRole("option", { name: "contains", exact: true }).click({ timeout: 5_000 });
					await page.locator(".db-value-prompt").waitFor({ timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
			{
				name: "filter-property-list",
				setup: async (page) => {
					// Open the property picker (where the type icons live). Prefer the
					// bar's "+ Filter" chip (opens the list directly even when filters
					// already exist); fall back to the funnel for an empty view.
					const addChip = page.locator(".db-filter-bar__add", { hasText: "Filter" });
					if (await addChip.count()) {
						await addChip.first().click({ timeout: 5_000 });
					} else {
						await page.locator("#toolbar-filter").click({ timeout: 5_000 });
					}
					await page.getByRole("option", { name: "Name", exact: true }).waitFor({ timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
		],
	},
	{
		kind: "app",
		appId: "io.brainstorm.graph",
		label: "Graph",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.tasks",
		label: "Tasks",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.calendar",
		label: "Calendar",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.journal",
		label: "Journal",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.preview",
		label: "Preview",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.code-editor",
		label: "Code Editor",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.whiteboard",
		label: "Whiteboard",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.bookmarks",
		label: "Bookmarks",
		states: [{ name: "default" }],
	},
	// Not-yet-built stubs — each lands on the shared coming-soon placeholder.
	{
		kind: "app",
		appId: "io.brainstorm.theme-editor",
		label: "Theme Editor",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.books",
		label: "Books",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.contacts",
		label: "Contacts",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.form-designer",
		label: "Form Designer",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.automations",
		label: "Automations",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.mailbox",
		label: "Mailbox",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.browser",
		label: "Web Browser",
		states: [{ name: "default" }],
	},
	{
		kind: "app",
		appId: "io.brainstorm.agent",
		label: "Agent",
		states: [{ name: "default" }],
	},
];

export const SHELL_SPECS: ReadonlyArray<ShellVisualSpec> = [
	{
		kind: "shell",
		id: "dashboard",
		label: "Dashboard",
		states: [
			{
				name: "default",
				// Shell states share the one dashboard page — dismiss any
				// leftover overlay (changelog popover, a prior state's menu)
				// before capturing.
				setup: async (page) => {
					await dismissOverlays(page);
				},
			},
		],
	},
	{
		kind: "shell",
		id: "launcher",
		label: "Launcher palette",
		states: [
			{
				name: "open",
				setup: async (page) => {
					await dismissOverlays(page);
					await page.locator('[aria-label="Search the vault"]').first().click({ timeout: 5_000 });
					await page
						.locator(".fm-menu.launcher-menu")
						.first()
						.waitFor({ state: "visible", timeout: 5_000 });
					await page.waitForTimeout(200);
				},
			},
		],
	},
];

export const ALL_SPECS: ReadonlyArray<VisualSpec> = [...SHELL_SPECS, ...APP_SPECS];

export type VisualTheme = "light" | "dark";

export const THEMES: ReadonlyArray<VisualTheme> = ["light", "dark"];
