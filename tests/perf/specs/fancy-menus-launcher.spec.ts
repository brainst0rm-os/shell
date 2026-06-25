/**
 * Stage 8.8 verification — the launcher palette, migrated from the bespoke
 * combobox overlay to a `@react-fancy-menus` ComposedBody (search panel over
 * a sectioned Apps/Entities list). Launches the production shell, seeds demo
 * apps, opens the launcher via its chord, and asserts the fancy-menus surface
 * renders app rows, filters, and dismisses.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForDashboard } from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

/** Create + activate a vault, reload to route to the dashboard, then seed
 *  demo apps so the launcher has installed apps to list. */
async function openSeededDashboard(page: Page, userDataDir: string): Promise<void> {
	await page.evaluate(
		async ({ d }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							create: (o: { name: string; path: string }) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
					};
				}
			).brainstorm;
			await bs.vaults.create({ name: "fm-verify", path: `${d}/vault` });
			await bs.vaults.session();
		},
		{ d: userDataDir },
	);
	await page.reload();
	await waitForDashboard(page);
	await page.evaluate(async () => {
		await (
			window as unknown as { brainstorm: { dev: { seedDemoApps: () => Promise<unknown> } } }
		).brainstorm.dev.seedDemoApps();
	});
}

/** Open the launcher the way its `⌘Space` accelerator does — by posting the
 *  `shell:action` IPC from the main process. (Under Playwright the renderer
 *  never sees the OS accelerator, so we drive the same main→renderer path.) */
async function openLauncher(app: ElectronApplication): Promise<void> {
	await app.evaluate(({ BrowserWindow }) => {
		const win =
			BrowserWindow.getAllWindows().find((w) => !w.getParentWindow()) ??
			BrowserWindow.getAllWindows()[0];
		win?.webContents.send("shell:action", { action: "launcher" });
	});
}

test.describe("fancy-menus launcher", () => {
	test("opens, lists apps, filters, and dismisses as a fancy-menus surface", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-launcher-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				await openLauncher(app);

				const menu = dashboard.locator(".fm-menu.launcher-menu");
				await menu.waitFor({ state: "visible", timeout: 10_000 });

				// App rows render (the Apps section + at least one app title).
				await expect(menu.locator(".launcher-menu__title").first()).toBeVisible();
				expect(await menu.locator(".launcher-menu__title").count()).toBeGreaterThan(0);

				await dashboard.screenshot({
					path: "tests/perf/results/fancy-menus-launcher-open.png",
				});

				// Filter the app list down by typing into the search panel.
				const firstTitle = await menu.locator(".launcher-menu__title").first().textContent();
				const search = menu.locator("input").first();
				await search.fill((firstTitle ?? "a").slice(0, 3));
				await expect(menu.locator(".launcher-menu__title").first()).toBeVisible();

				await dashboard.screenshot({
					path: "tests/perf/results/fancy-menus-launcher-filtered.png",
				});

				// Escape dismisses the surface.
				await dashboard.keyboard.press("Escape");
				await menu.waitFor({ state: "hidden", timeout: 5_000 });
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
