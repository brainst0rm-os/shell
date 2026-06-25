/**
 * Stage 8.8 verification — the cheatsheet overlay, migrated from the
 * `<Popover>` plain-DOM list to a `@react-fancy-menus/core` command-palette
 * menu. Launches the production shell, opens the cheatsheet via its chord,
 * and asserts the fancy-menus surface renders, filters, and dismisses.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { waitForDashboard } from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

/** Create + activate a vault, then reload so the renderer routes to the
 *  dashboard (programmatic create doesn't fire the live session-changed
 *  broadcast the welcome UI rides; a reload reads the now-active session). */
async function openDashboard(page: Page, userDataDir: string): Promise<void> {
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
}

test.describe("fancy-menus cheatsheet", () => {
	test("opens, filters, and dismisses as a fancy-menus surface", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-cheatsheet-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openDashboard(dashboard, userDataDir);

				// Open via the dashboard's cheatsheet button (the chord wiring is
				// unchanged by the migration; both set `cheatsheetOpen`).
				await dashboard.getByRole("button", { name: "Open shortcuts cheatsheet" }).first().click();

				// The menu portals to body as `.fm-menu`; the cheatsheet config
				// tags it with `cheatsheet-menu` via chrome.className.
				const menu = dashboard.locator(".fm-menu.cheatsheet-menu");
				await menu.waitFor({ state: "visible", timeout: 10_000 });

				// Rows render with their chord tokens (the launcher row + its <kbd>).
				await expect(menu.getByText("Open launcher").first()).toBeVisible();
				expect(await menu.locator("kbd.cheatsheet__key").count()).toBeGreaterThan(0);

				await dashboard.screenshot({
					path: "tests/perf/results/fancy-menus-cheatsheet-open.png",
				});

				// Filter to a single action; unrelated rows drop out.
				const search = menu.locator("input").first();
				await search.fill("marketplace");
				await expect(menu.getByText(/marketplace/i).first()).toBeVisible();
				await expect(menu.getByText("Open launcher")).toHaveCount(0);

				await dashboard.screenshot({
					path: "tests/perf/results/fancy-menus-cheatsheet-filtered.png",
				});

				// Escape dismisses the whole surface.
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
