/**
 * Tasks tags + tag filter end-to-end smoke (9.14.10).
 *
 * Boots the real Electron shell, opens a task, adds a tag, then clicks the tag
 * to activate the filter — asserting the tag chip appears and the header filter
 * pill shows, with no renderer console errors.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConsoleMessage, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-tags");

test("tasks detail → add a tag, click it to filter", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-tags-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const reseed = await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: { dev: { reseedVault: () => Promise<{ ok: boolean; reason?: string }> } };
				}
			).brainstorm;
			return bs.dev.reseedVault();
		});
		expect(reseed.ok, `seed-cli failed: ${reseed.reason ?? ""}`).toBe(true);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.tasks"),
		);
		const tasks = await waitForAppTabPage(app);
		tasks.on("console", trackConsole);
		await tasks.waitForLoadState("load", { timeout: 30_000 });

		await tasks.waitForSelector(".task-row", { state: "visible", timeout: 30_000 });
		await tasks.locator(".task-row .task-row__body").first().click();
		await tasks.waitForSelector(".tasks-detail", { state: "visible", timeout: 10_000 });

		// Add a tag.
		const addInput = tasks.locator(".tasks-detail__tag-add-input");
		await expect(addInput).toBeVisible({ timeout: 10_000 });
		await addInput.scrollIntoViewIfNeeded();
		await addInput.fill("urgent");
		await addInput.press("Enter");

		// The tag chip appears.
		const chip = tasks.locator(".tasks-detail__tag-label", { hasText: "urgent" });
		await expect(chip).toHaveCount(1, { timeout: 10_000 });

		// Clicking the tag activates the filter → header pill shows.
		await chip.click();
		await expect(tasks.locator(".tasks-header__filter-pill")).toBeVisible({ timeout: 10_000 });

		await tasks.screenshot({ path: join(SCREENSHOT_DIR, "01-tag-filter.png"), fullPage: false });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await tasks.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
});
