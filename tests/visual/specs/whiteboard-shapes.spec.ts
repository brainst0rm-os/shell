/**
 * Whiteboard primitive shapes end-to-end smoke (9.17.10).
 *
 * Boots the real Electron shell, adds a Rectangle and an Ellipse from the Add
 * menu, and asserts each renders its shape node with no renderer console errors.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-shapes");

test("whiteboard Add → Rectangle + Ellipse render shape nodes", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-shapes-"));
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

		const addTrigger = wb.locator(".whiteboard__add-trigger");
		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Rectangle" }).click();
		await expect(wb.locator(".whiteboard__node--shape-rectangle")).toHaveCount(1, {
			timeout: 10_000,
		});

		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Ellipse" }).click();
		await expect(wb.locator(".whiteboard__node--shape-ellipse")).toHaveCount(1, { timeout: 10_000 });

		// Each shape painted its fill div.
		await expect(wb.locator(".whiteboard__shape-fill")).toHaveCount(2);

		// SVG primitives (9.17.10): triangle / diamond fill a polygon; line /
		// arrow stroke a line (arrow adds a head polygon).
		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Triangle" }).click();
		await expect(
			wb.locator(".whiteboard__node--shape-triangle .whiteboard__shape-svg--fill"),
		).toHaveCount(1, { timeout: 10_000 });

		await addTrigger.click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Arrow" }).click();
		const arrowSvg = wb.locator(".whiteboard__node--shape-arrow .whiteboard__shape-svg--stroke");
		await expect(arrowSvg).toHaveCount(1, { timeout: 10_000 });
		await expect(arrowSvg.locator("polygon.whiteboard__shape-svg-head")).toHaveCount(1);

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-shapes.png"), fullPage: false });

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
