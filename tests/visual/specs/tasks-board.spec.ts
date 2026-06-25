/**
 * Tasks status board end-to-end smoke (9.14.10).
 *
 * Boots the real Electron shell, selects the Board surface, and asserts the
 * kanban renders: the canonical status columns + real task cards, no renderer
 * console errors. The drag-to-change-status drop logic is unit-tested
 * (board-view.test.ts); native HTML5 DnD is unreliable under Playwright, so
 * this verifies the sidebar→surface→compileBoard→cards integration.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-board");

test("tasks Board surface renders status columns + cards", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-board-"));
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

		// Select the Board surface from the sidebar.
		await tasks.locator('[data-surface="board"]').click();

		// The board renders with the canonical status columns.
		await tasks.waitForSelector(".tasks-board", { state: "visible", timeout: 10_000 });
		const columnCount = await tasks.locator(".tasks-board__column").count();
		expect(columnCount).toBeGreaterThanOrEqual(4); // No status + todo/in-progress/done/cancelled
		// At least one real task card painted (seeded vault has tasks).
		await expect(tasks.locator(".tasks-board__card").first()).toBeVisible({ timeout: 10_000 });

		await tasks.screenshot({ path: join(SCREENSHOT_DIR, "01-board.png"), fullPage: false });

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
