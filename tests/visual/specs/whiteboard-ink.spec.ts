/**
 * Whiteboard freehand-ink end-to-end smoke (9.17.9).
 *
 * Boots the real Electron shell, selects the Pen tool (asserting the toolbar
 * reflects it), then commits a stroke via the `__brainstormWhiteboardDev`
 * `drawInk` hook (a synthetic Playwright pointer can't drive
 * `setPointerCapture`, so the capture drag can't be exercised directly) and
 * asserts an ink node renders its stroked SVG polyline with no console errors.
 * The geometry / normalisation is unit-tested (ink.test.ts) + the codec
 * round-trip (codec.test.ts); this proves the build → mount → render wiring.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-ink");

type Dev = { drawInk: (points: ReadonlyArray<{ x: number; y: number }>) => string | null };

test("whiteboard pen tool commits a freehand ink stroke", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-ink-"));
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

		// Select the Pen tool — the toolbar button reflects it.
		const penBtn = wb.locator('.whiteboard__tool[aria-label="Pen"]');
		await penBtn.click();
		await expect(penBtn).toHaveAttribute("aria-pressed", "true");

		// Commit a stroke (the capture drag itself can't be driven headless).
		await wb.evaluate(() => {
			const dev = (window as unknown as { __brainstormWhiteboardDev: Dev }).__brainstormWhiteboardDev;
			const id = dev.drawInk([
				{ x: 200, y: 200 },
				{ x: 260, y: 280 },
				{ x: 340, y: 220 },
				{ x: 400, y: 300 },
			]);
			if (!id) throw new Error("drawInk rejected the stroke");
		});

		const inkNode = wb.locator(".whiteboard__node--ink");
		await expect(inkNode).toHaveCount(1, { timeout: 10_000 });
		await expect(inkNode.locator(".whiteboard__ink-svg polyline")).toHaveCount(1);

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-ink.png"), fullPage: false });

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
