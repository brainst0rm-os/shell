/**
 * Tasks subtasks end-to-end smoke (9.14.7).
 *
 * Boots the real Electron shell, opens a seeded task's detail route, and
 * exercises the Subtasks section: typing a name + submitting the add field
 * creates a child task that appears in the list, with no renderer console
 * errors. jsdom covers the render/handlers; this proves the create→persist→
 * re-render path through the real app + entities service.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-subtasks");

test("tasks detail → add a subtask, it appears in the Subtasks section", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-subtasks-"));
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

		// Open the first task's detail route.
		await tasks.locator(".task-row .task-row__body").first().click();
		await tasks.waitForSelector(".tasks-detail", { state: "visible", timeout: 10_000 });

		// The Subtasks section + its add field are present.
		const addInput = tasks.locator(".tasks-detail__subtask-add-input");
		await expect(addInput).toBeVisible({ timeout: 10_000 });
		const before = await tasks.locator(".tasks-detail__subtask").count();

		await addInput.click();
		await addInput.type("Draft the outline", { delay: 25 });
		await addInput.press("Enter");

		// A new subtask row appears carrying the typed name.
		await expect(tasks.locator(".tasks-detail__subtask")).toHaveCount(before + 1, {
			timeout: 10_000,
		});
		await expect(
			tasks.locator(".tasks-detail__subtask-name", { hasText: "Draft the outline" }),
		).toHaveCount(1);
		// The progress count reflects the new child (0/N done).
		await expect(tasks.locator(".tasks-detail__subtasks-count")).toBeVisible();

		await tasks.screenshot({ path: join(SCREENSHOT_DIR, "01-subtask-added.png"), fullPage: false });

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
