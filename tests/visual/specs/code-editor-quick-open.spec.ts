/**
 * Code-editor quick-open palette end-to-end smoke (9.7.5).
 *
 * Boots the real shell + seeded vault (the seeder writes plan-reference code
 * files), opens the Code Editor, presses Cmd+P, types a fragment of a
 * not-currently-open file, and presses Enter — asserting the palette opened
 * and the picked file became the active file, with no page errors. The fuzzy
 * ranking is unit-tested (fuzzy-file.test.ts); this proves the live wiring.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "code-editor-quick-open");

test("code-editor Cmd+P quick-open jumps to a file", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-ce-quickopen-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);
		// Seed entities (the code files the palette lists) — `ensureVaultAndSeed`
		// only installs the apps.
		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { dev: { reseedVault: () => Promise<unknown> } } }
			).brainstorm.dev.reseedVault(),
		);

		const pageErrors: string[] = [];
		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.code-editor"),
		);
		const ed = await waitForAppTabPage(app);
		ed.on("pageerror", (e) => pageErrors.push(e.message));
		await ed.waitForLoadState("load", { timeout: 30_000 });
		await ed.waitForSelector(".editor__file", { state: "visible", timeout: 30_000 });

		// Need at least two files to prove a *jump* changed the selection.
		const names = await ed.locator(".editor__file-name").allInnerTexts();
		expect(names.length).toBeGreaterThanOrEqual(2);
		const currentName = (
			await ed.locator('.editor__file[aria-current="true"] .editor__file-name').innerText()
		).trim();
		const targetName = names.map((n) => n.trim()).find((n) => n && n !== currentName);
		if (!targetName) throw new Error("no second file to jump to");

		// Open the palette (Cmd+P) and type a distinctive fragment of the target.
		await ed.locator("body").click();
		await ed.keyboard.press("Meta+p");
		const palette = ed.locator(".editor__quickopen");
		await expect(palette).toBeVisible({ timeout: 10_000 });

		const stem = targetName.replace(/\.[^.]+$/, "");
		await ed.locator(".editor__quickopen-input").fill(stem.slice(0, Math.min(6, stem.length)));
		await expect(ed.locator(".editor__quickopen-item").first()).toBeVisible({ timeout: 5_000 });
		await ed.screenshot({ path: join(SCREENSHOT_DIR, "01-palette.png"), fullPage: false });

		await ed.keyboard.press("Enter");
		await expect(palette).toHaveCount(0, { timeout: 10_000 });

		// The jumped-to file is now the active one.
		const nowCurrent = (
			await ed.locator('.editor__file[aria-current="true"] .editor__file-name').innerText()
		).trim();
		expect(nowCurrent).toBe(targetName);
		expect(nowCurrent).not.toBe(currentName);

		expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);

		await ed.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
