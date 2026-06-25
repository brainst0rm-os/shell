/**
 * Stage 8.8 verification — the dashboard icon context menu, migrated from a
 * bespoke absolutely-positioned panel to the shared `openContextMenu`
 * (fancy-menus) imperative bridge. Right-clicking a dashboard icon opens a
 * cursor-anchored fancy-menu with the icon's actions; Escape dismisses it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForDashboard } from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

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

test.describe("fancy-menus icon context menu", () => {
	test("right-click opens a cursor-anchored fancy-menu that Escape dismisses", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-iconctx-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				// The "What's new" popover auto-shows on a fresh vault and its
				// backdrop covers the icons — dismiss it before right-clicking.
				const whatsNew = dashboard.locator(".popover");
				if (await whatsNew.isVisible().catch(() => false)) {
					await dashboard.keyboard.press("Escape");
					await whatsNew.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
				}

				const icon = dashboard.locator(".dashboard-icons__icon").first();
				await icon.waitFor({ state: "visible", timeout: 10_000 });
				await icon.click({ button: "right" });

				const menu = dashboard.locator('.fm-menu[role="menu"]');
				await menu.waitFor({ state: "visible", timeout: 10_000 });

				// The shared object-actions: Open + a remove/unpin action.
				await expect(menu.getByText("Open", { exact: true })).toBeVisible();
				expect(await menu.locator(".fm-row").count()).toBeGreaterThan(1);

				await dashboard.screenshot({
					path: "tests/perf/results/fancy-menus-icon-context.png",
				});

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
