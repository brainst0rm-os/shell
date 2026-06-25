/**
 * Whiteboard z-order / layering end-to-end smoke (9.17.13).
 *
 * Boots the real Electron shell, drops two sticky nodes, selects all, and runs
 * a z-order action from the Arrange menu — asserting the nodes get a zIndex and
 * no renderer console errors. The reordering math is unit-tested (z-order.test.ts);
 * this proves the menu→applyZOrder→persist→paint path against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-zorder");

test("whiteboard Arrange → z-order reorders the selection", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-zorder-"));
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

		// Add two sticky notes via the Add menu (drops at viewport centre — no
		// canvas hit-testing through the pan-wrap).
		const addTrigger = wb.locator(".whiteboard__add-trigger");
		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();

		await expect(wb.locator(".whiteboard__node")).toHaveCount(2, { timeout: 10_000 });

		// Select all + bring to front via the Arrange menu.
		await wb.keyboard.press("Meta+a");
		await wb.locator(".whiteboard__arrange-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Bring to front" }).click();

		// Every node now carries an explicit zIndex (the densify ran).
		const withZ = await wb
			.locator(".whiteboard__node")
			.evaluateAll((els) => els.filter((el) => (el as HTMLElement).style.zIndex !== "").length);
		expect(withZ).toBe(2);

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-zorder.png"), fullPage: false });

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
