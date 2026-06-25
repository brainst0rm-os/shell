/**
 * Tasks time estimate end-to-end smoke (9.14.13).
 *
 * Boots the real Electron shell, opens a seeded task, types an estimate into
 * the Time section, and asserts it formats + persists (the input reflects the
 * parsed duration) with no renderer console errors.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-time");

test("tasks detail → type a time estimate, it formats + persists", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-time-"));
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

		const estimate = tasks.locator(".tasks-detail__time-input").first();
		await expect(estimate).toBeVisible({ timeout: 10_000 });
		await estimate.scrollIntoViewIfNeeded();
		// `fill` (not `click`) so the assertion doesn't depend on pointer-event
		// hit-testing under the sticky header — it focuses + sets the value.
		await estimate.fill("2h30m");
		await estimate.press("Enter");

		// The field reflects the parsed + formatted duration.
		await expect(estimate).toHaveValue("2h 30m", { timeout: 10_000 });

		await tasks.screenshot({ path: join(SCREENSHOT_DIR, "01-estimate.png"), fullPage: false });

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
