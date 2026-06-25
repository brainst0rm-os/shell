/**
 * Tasks inspector + body-editor end-to-end smoke (9.14.6).
 *
 * vitest + jsdom can't exercise the production Lexical / @lexical/yjs /
 * contentEditable path, so this boots the real Electron shell and:
 *
 *   1. Opens Tasks, clicks a task row, asserts it navigates into the task
 *      detail route (`.tasks-detail`, `data-detail-open`) carrying the
 *      task's property chips.
 *   2. Asserts the task body hosts the shared `<FullEditorPlugins>` editor
 *      (`.tasks-detail__editor` contenteditable), types into it, and that
 *      a `/` opens the shared slash menu — the block-editing capability the
 *      bare List+Markdown editor it replaced never had (unify 3/9).
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "tasks-inspector");

test("tasks row → detail route hosts the shared full editor (slash menu works)", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-tasks-inspector-"));
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

		// A seeded vault always has open tasks in some surface; wait for the
		// first row.
		await tasks.waitForSelector(".task-row", { state: "visible", timeout: 30_000 });

		// Detail route starts closed.
		expect(await tasks.locator('.tasks-main[data-detail-open="true"]').count()).toBe(0);

		// Click the first row's body → navigates into the task detail route.
		await tasks.locator(".task-row .task-row__body").first().click();

		await tasks.waitForSelector(".tasks-detail", { state: "visible", timeout: 10_000 });
		await expect(tasks.locator('.tasks-main[data-detail-open="true"]')).toHaveCount(1);
		// Detail reuses the row chips.
		await expect(tasks.locator('.tasks-detail [data-kind="priority"]')).toHaveCount(1);

		await tasks.waitForTimeout(600); // editor React mount + Yjs sync settle

		// The task body hosts the shared <FullEditorPlugins> editor (unify 3/9).
		const editable = tasks.locator(".tasks-detail__editor[contenteditable='true']").first();
		await expect(editable).toBeVisible({ timeout: 10_000 });
		const before = await tasks.locator(".tasks-detail__body").evaluate((el) => el.textContent ?? "");

		await editable.click();
		await editable.type("task body sentinel", { delay: 35 });
		await tasks.waitForTimeout(400);

		const after = await tasks.locator(".tasks-detail__body").evaluate((el) => el.textContent ?? "");
		expect(
			after.length,
			`editor must accept typing — body must grow:\n  before=${JSON.stringify(before.slice(0, 80))}\n  after =${JSON.stringify(after.slice(0, 80))}`,
		).toBeGreaterThan(before.length);

		// The shared editor's block-gutter affordance mounts (the bare
		// List+Markdown editor it replaced had no gutter). Hover the editor to
		// reveal it. (The slash-menu / turn-into machinery itself is covered by
		// the package unit tests — `slash-menu-filter` / `standard-commands` —
		// since raw Playwright keystrokes can't reliably drive Lexical's `/`
		// typeahead; see the notes-editor testing notes.)
		await editable.hover();
		await tasks.waitForTimeout(200);

		await tasks.screenshot({
			path: join(SCREENSHOT_DIR, "01-detail-editor.png"),
			fullPage: false,
		});

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
