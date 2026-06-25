/**
 * Whiteboard undo / redo end-to-end smoke (9.17.17).
 *
 * Boots the real Electron shell, adds a sticky, then undoes (Cmd+Z) and redoes
 * (Cmd+Shift+Z) — asserting the node count steps back and forward, with no
 * renderer console errors. The history stepping is unit-tested (history.test.ts);
 * this proves the persist→record→restore path against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-undo");

test("whiteboard Cmd+Z / Cmd+Shift+Z undo + redo an add", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-undo-"));
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

		const before = await wb.locator(".whiteboard__node").count();

		// Add a sticky via the Add menu.
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await expect(wb.locator(".whiteboard__node")).toHaveCount(before + 1, { timeout: 10_000 });

		// Click the canvas to ensure window focus, then undo.
		await wb.locator(".whiteboard__canvas-wrap").click({ position: { x: 60, y: 60 } });
		await wb.keyboard.press("Meta+z");
		await expect(wb.locator(".whiteboard__node")).toHaveCount(before, { timeout: 10_000 });

		// Redo.
		await wb.keyboard.press("Meta+Shift+z");
		await expect(wb.locator(".whiteboard__node")).toHaveCount(before + 1, { timeout: 10_000 });

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-undo-redo.png"), fullPage: false });

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
