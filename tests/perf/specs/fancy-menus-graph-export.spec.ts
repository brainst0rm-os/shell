/**
 * Stage 8.8 verification — Phase B (apps). The graph app mounts a fancy-menus
 * host (`mountMenuHost`) at boot, so its export menu — which goes through the
 * shared `openAnchoredMenu` → `openContextMenu` bridge — renders as a themed
 * fancy-menu inside the sandboxed app window. This is the representative
 * proof that the per-app host wiring works end-to-end in a real app renderer.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
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

/** Click a dashboard app icon and return the app's new window. */
async function launchApp(app: ElectronApplication, dashboard: Page, label: string): Promise<Page> {
	const whatsNew = dashboard.locator(".popover");
	if (await whatsNew.isVisible().catch(() => false)) {
		await dashboard.keyboard.press("Escape");
		await whatsNew.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
	}
	const icon = dashboard.locator(".dashboard-icons__icon", { hasText: label }).first();
	await icon.waitFor({ state: "visible", timeout: 10_000 });
	const [appWindow] = await Promise.all([app.waitForEvent("window"), icon.click()]);
	await appWindow.waitForLoadState("domcontentloaded");
	return appWindow;
}

test.describe("fancy-menus graph export (app host)", () => {
	test("the graph export menu opens as a fancy-menu in the app window", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-graph-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const graph = await launchApp(app, dashboard, "Graph");

				const exportBtn = graph.locator('button[aria-haspopup="menu"]').first();
				await exportBtn.waitFor({ state: "visible", timeout: 20_000 });
				await exportBtn.click();

				const menu = graph.locator('.fm-menu[role="menu"]');
				await menu.waitFor({ state: "visible", timeout: 10_000 });
				expect(await menu.locator(".fm-row").count()).toBeGreaterThan(1);

				await graph.screenshot({ path: "tests/perf/results/fancy-menus-graph-export.png" });

				await graph.keyboard.press("Escape");
				await menu.waitFor({ state: "hidden", timeout: 5_000 });
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
