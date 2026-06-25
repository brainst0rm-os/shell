/**
 * Whiteboard layers panel end-to-end smoke (9.17.13).
 *
 * Boots the real Electron shell, adds a sticky, opens the Layers panel, and
 * toggles a node's visibility — asserting the canvas node count drops then
 * restores, with no renderer console errors. The list ordering is unit-tested
 * (layer-list.test.ts); this proves the panel + hide path against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-layers");

test("whiteboard Layers panel lists nodes + toggles visibility", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-layers-"));
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

		// Ensure at least one node exists.
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await expect(wb.locator(".whiteboard__node").first()).toBeVisible({ timeout: 10_000 });

		// Open the Layers panel.
		await wb.locator(".whiteboard__layers-toggle").click();
		await expect(wb.locator(".whiteboard__layers")).toBeVisible({ timeout: 10_000 });
		expect(await wb.locator(".whiteboard__layer").count()).toBeGreaterThanOrEqual(1);

		// Hide the first layer's node → canvas node count drops by one.
		const canvasBefore = await wb.locator(".whiteboard__node").count();
		await wb.locator(".whiteboard__layer-vis").first().click();
		await expect(wb.locator(".whiteboard__node")).toHaveCount(canvasBefore - 1, { timeout: 10_000 });

		// Show it again → restored.
		await wb.locator(".whiteboard__layer-vis").first().click();
		await expect(wb.locator(".whiteboard__node")).toHaveCount(canvasBefore, { timeout: 10_000 });

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-layers.png"), fullPage: false });

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
