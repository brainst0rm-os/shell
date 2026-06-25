/**
 * Files bulk-action bar end-to-end smoke (9.8.12).
 *
 * Boots the real shell + seeded vault, opens Files, multi-selects two items
 * (click + Cmd-click), and exercises the floating bulk-action bar: it shows
 * the live count, Duplicate adds two copies to the folder, and Clear dismisses
 * the bar. The id-ordering helper is unit-tested (bulk.test.ts); this proves
 * the bar + its wiring to the store ops against the live app.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, expect, test } from "@playwright/test";
import { launchAppPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "files-bulk-actions");

test("files bulk-action bar multi-selects, duplicates, and clears", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-files-bulk-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);
		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { dev: { reseedVault: () => Promise<unknown> } } }
			).brainstorm.dev.reseedVault(),
		);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		const files = await launchAppPage(app, dashboard, "io.brainstorm.files");
		files.on("console", trackConsole);
		await files.waitForSelector('[data-testid="content-row"]', { state: "visible", timeout: 30_000 });

		const rows = files.locator('[data-testid="content-row"]');
		const before = await rows.count();
		expect(before).toBeGreaterThanOrEqual(2);

		// Multi-select: click the first row, Cmd-click the second.
		await rows.nth(0).click({ timeout: 10_000 });
		await rows.nth(1).click({ modifiers: ["Meta"], timeout: 10_000 });

		const bar = files.locator('[data-testid="bulk-bar"]');
		await expect(bar).toBeVisible({ timeout: 10_000 });
		await expect(bar.locator(".files-bulkbar__count")).toContainText("2 selected", {
			timeout: 10_000,
		});
		await files.screenshot({ path: join(SCREENSHOT_DIR, "01-bar.png"), fullPage: false });

		// Duplicate → two copies land in the folder.
		await files.locator('[data-testid="bulk-duplicate"]').click({ timeout: 10_000 });
		await expect(rows).toHaveCount(before + 2, { timeout: 15_000 });

		// Clear dismisses the bar.
		await files.locator('[data-testid="bulk-clear"]').click({ timeout: 10_000 });
		await expect(bar).toHaveCount(0, { timeout: 10_000 });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await files.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
