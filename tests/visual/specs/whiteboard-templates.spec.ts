/**
 * Whiteboard new-from-template end-to-end smoke (9.17.18).
 *
 * Boots the real Electron shell, opens the Whiteboard, then uses the board
 * list's "New whiteboard" menu to create a Kanban board (three titled frames +
 * a seed card) and a Flowchart board (four chained nodes + three connectors) —
 * asserting the live scene + edge count, with no renderer console errors. The
 * template scene builders are unit-tested (templates.test.ts); this proves the
 * menu → create-board → seed-scene → open wiring against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-templates");

test("whiteboard New menu seeds Kanban + Flowchart templates", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-tpl-"));
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

		// Header ⊕ (new board) → Kanban columns: three frames + one seed sticky.
		await wb.locator('[data-testid="whiteboard-new-board"]').click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Kanban columns" }).click();
		await expect(wb.locator(".whiteboard__node--frame")).toHaveCount(3, { timeout: 10_000 });
		await expect(wb.locator(".whiteboard__node")).toHaveCount(4);

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-kanban.png"), fullPage: false });

		// Header ⊕ → Flowchart: four nodes chained by three connectors. The edge
		// count is mirrored onto the node layer (the GPU canvas leaves no DOM).
		await wb.locator('[data-testid="whiteboard-new-board"]').click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Flowchart" }).click();
		await expect(wb.locator(".whiteboard__node")).toHaveCount(4, { timeout: 10_000 });
		await expect
			.poll(() => wb.locator(".whiteboard__nodes").evaluate((el) => el.dataset.edgeCount ?? "0"))
			.toBe("3");

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "02-flowchart.png"), fullPage: false });

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
