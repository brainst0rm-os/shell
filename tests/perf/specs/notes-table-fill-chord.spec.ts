/**
 * B11.3 — fill-down chord (`Mod+Shift+D`). With the caret in a table cell,
 * the chord copies that cell's value down its column. Verified end-to-end:
 * seed a cell value via the dev hook, fire the chord, assert the column fills.
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
			await bs.vaults.create({ name: "fm-fill-chord", path: `${d}/vault` });
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

test.describe("notes table fill-down chord (B11.3)", () => {
	test("Mod+Shift+D fills the selected cell's value down its column", async () => {
		test.setTimeout(300_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-fm-fill-chord-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const notes = await launchApp(app, dashboard, "Notes");
				await notes.locator('[contenteditable="true"]').first().waitFor({
					state: "visible",
					timeout: 20_000,
				});

				// Insert a table (caret lands in the first cell), seed that cell's
				// text, then fire the fill-down chord — all without keystrokes that
				// would corrupt the collab editor.
				await notes.evaluate(async () => {
					const dev = (
						window as unknown as {
							__brainstormNotesDev: {
								runBlockCommand: (id: string) => Promise<void>;
								setSelectedCellText: (text: string) => Promise<void>;
							};
						}
					).__brainstormNotesDev;
					await dev.runBlockCommand("block.table");
					await dev.setSelectedCellText("seed");
				});
				await expect(notes.locator("table").first()).toBeVisible({ timeout: 10_000 });

				await notes.keyboard.press("ControlOrMeta+Shift+D");

				// Every cell in the first column now reads "seed".
				await expect
					.poll(() =>
						notes.evaluate(() => {
							const rows = Array.from(document.querySelectorAll("table tr"));
							return rows.map((r) => r.querySelector("th,td")?.textContent ?? "");
						}),
					)
					.toEqual(["seed", "seed", "seed"]);
			} finally {
				await app.close();
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
