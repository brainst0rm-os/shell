/**
 * Whiteboard object-lock end-to-end smoke (9.17.15).
 *
 * Boots the real Electron shell, adds a sticky, locks it via the Arrange menu,
 * then attempts to drag it — asserting it carries the locked class and does NOT
 * move, with no renderer console errors.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-lock");

test("whiteboard Arrange → Lock keeps a node selectable but unmovable", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-lock-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.whiteboard"),
		);
		const wb = await waitForAppTabPage(app);
		wb.on("console", trackConsole);
		await wb.waitForLoadState("load", { timeout: 30_000 });
		await wb.waitForSelector(".whiteboard__canvas", { state: "visible", timeout: 30_000 });

		// Add a sticky via the Add menu.
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		const node = wb.locator(".whiteboard__node").first();
		await expect(node).toBeVisible({ timeout: 10_000 });

		// Select it + Lock via Arrange.
		await node.click();
		await wb.locator(".whiteboard__arrange-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: /^Lock$/ }).click();
		await expect(wb.locator(".whiteboard__node--locked")).toHaveCount(1, { timeout: 10_000 });

		// Attempt to drag the locked node — it must not move.
		const before = await node.evaluate((el) => (el as HTMLElement).style.left);
		const box = await node.boundingBox();
		if (box) {
			await wb.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await wb.mouse.down();
			await wb.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 90, { steps: 5 });
			await wb.mouse.up();
		}
		const after = await wb
			.locator(".whiteboard__node")
			.first()
			.evaluate((el) => (el as HTMLElement).style.left);
		expect(after).toBe(before);

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-locked.png"), fullPage: false });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await wb.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
});
