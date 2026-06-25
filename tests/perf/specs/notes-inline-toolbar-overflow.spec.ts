/**
 * B11.2 — inline toolbar overflow `…` menu. Selecting text shows the toolbar;
 * the overflow menu houses Remove-formatting (clears marks) and Inline-equation
 * (wraps the selection as a KaTeX equation). Verified end-to-end in the shell.
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
			await bs.vaults.create({ name: "fm-overflow", path: `${d}/vault` });
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

async function launchApp(app: ElectronApplication, dashboard: Page, label: string): Promise<Page> {
	const whatsNew = dashboard.locator(".popover");
	if (await whatsNew.isVisible().catch(() => false)) {
		await dashboard.keyboard.press("Escape");
		await whatsNew.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
	}
	const icon = dashboard.locator(".dashboard-icons__icon", { hasText: label }).first();
	await icon.waitFor({ state: "visible", timeout: 10_000 });
	const [win] = await Promise.all([app.waitForEvent("window"), icon.click()]);
	await win.waitForLoadState("domcontentloaded");
	return win;
}

test.describe("notes inline toolbar overflow (B11.2)", () => {
	test("overflow `…` opens; remove-formatting clears a mark; inline equation wraps the selection", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-overflow-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const notes = await launchApp(app, dashboard, "Notes");
				const para = notes.locator('[contenteditable="true"] p').first();
				await para.waitFor({ state: "visible", timeout: 20_000 });

				const selectPara = async () => {
					await para.click({ clickCount: 3 });
					await expect
						.poll(() => notes.evaluate(() => (window.getSelection()?.toString() ?? "").length))
						.toBeGreaterThan(0);
				};

				// Bold the selection so there's a mark to remove.
				await selectPara();
				const toolbar = notes.locator(".notes__inline-toolbar");
				await expect(toolbar).toBeVisible({ timeout: 5_000 });
				await toolbar.locator(".notes__inline-toolbar-btn").first().click();
				await expect(notes.locator('[contenteditable="true"] .notes__text--bold').first()).toBeVisible({
					timeout: 5_000,
				});

				// Re-select, open the overflow menu, remove formatting → the bold
				// mark is gone.
				await selectPara();
				await toolbar.locator(".notes__inline-toolbar-overflow .notes__inline-toolbar-btn").click();
				const overflow = notes.locator(".notes__inline-overflow-menu");
				await expect(overflow).toBeVisible({ timeout: 5_000 });
				await overflow.getByRole("menuitem", { name: "Remove formatting" }).click();
				await expect(notes.locator('[contenteditable="true"] .notes__text--bold')).toHaveCount(0, {
					timeout: 5_000,
				});

				// Re-select, open overflow, Inline equation → the selection becomes
				// an inline equation node.
				await selectPara();
				await toolbar.locator(".notes__inline-toolbar-overflow .notes__inline-toolbar-btn").click();
				await expect(overflow).toBeVisible({ timeout: 5_000 });
				await overflow.getByRole("menuitem", { name: "Inline equation" }).click();
				await expect(
					notes.locator('[contenteditable="true"] .notes__equation--inline').first(),
				).toBeVisible({ timeout: 5_000 });
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
