/**
 * B11.7 — bulk indent/outdent. With multiple blocks selected (block-selection
 * mode), Tab indents the whole selection and Shift+Tab outdents it — extending
 * the single-block indent to the multi-block path. Verified in the real shell.
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
			await bs.vaults.create({ name: "fm-indent", path: `${d}/vault` });
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

test.describe("notes bulk indent (B11.7)", () => {
	test("Tab indents a multi-block selection; Shift+Tab outdents it", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-indent-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const notes = await launchApp(app, dashboard, "Notes");
				const para = notes.locator('[contenteditable="true"] p').first();
				await para.waitFor({ state: "visible", timeout: 20_000 });

				// Enter block-selection mode: caret in a block, Mod+a selects the
				// containing block, a second Mod+a selects every top-level block.
				await para.click();
				await notes.keyboard.press("ControlOrMeta+a");
				await notes.keyboard.press("ControlOrMeta+a");
				await expect
					.poll(() => notes.locator(".bs-editor__block--selected").count())
					.toBeGreaterThan(1);

				const padOf = () =>
					para.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingInlineStart || "0"));
				const before = await padOf();

				// Tab → the whole selection indents one level.
				await notes.keyboard.press("Tab");
				await expect.poll(padOf).toBeGreaterThan(before);
				const indented = await padOf();

				// Shift+Tab → it drops back.
				await notes.keyboard.press("Shift+Tab");
				await expect.poll(padOf).toBeLessThan(indented);
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
