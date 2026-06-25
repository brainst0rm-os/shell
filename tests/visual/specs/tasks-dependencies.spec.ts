/**
 * Tasks dependencies end-to-end smoke (9.14.8).
 *
 * Boots the real Electron shell, opens a seeded task, adds a blocker via the
 * "Add blocker" picker, and asserts the blocker appears in the Blocked-by
 * section with a "Blocked" flag — no renderer console errors. jsdom covers the
 * render/handlers + the pure cycle logic; this proves the add→persist→re-render
 * path + the anchored picker against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-dependencies");

test("tasks detail → add a blocker, it appears in Blocked-by with a Blocked flag", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-deps-"));
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

		// No blockers yet.
		expect(await tasks.locator(".tasks-detail__blockedby .tasks-detail__subtask").count()).toBe(0);

		// Open the "Add blocker" picker and choose the first candidate.
		await tasks.locator(".tasks-detail__dep-add").click();
		const firstCandidate = tasks.locator(".fm-menu .fm-row").first();
		await expect(firstCandidate).toBeVisible({ timeout: 10_000 });
		await firstCandidate.click();

		// A blocker row + a "Blocked" flag appear.
		await expect(tasks.locator(".tasks-detail__blockedby .tasks-detail__subtask")).toHaveCount(1, {
			timeout: 10_000,
		});
		await expect(tasks.locator(".tasks-detail__blocked-flag")).toBeVisible();

		await tasks.screenshot({ path: join(SCREENSHOT_DIR, "01-blocker-added.png"), fullPage: false });

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
