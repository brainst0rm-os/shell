/**
 * Whiteboard node-styling end-to-end smoke (9.17.12).
 *
 * Boots the real Electron shell, adds a sticky (auto-selected), then uses the
 * Style ▾ header menu to recolour its fill and bump its text size — asserting
 * the live node element's `--node-tint` / `--node-text-size` custom properties
 * update, with no renderer console errors. The selection transforms are
 * unit-tested (node-style.test.ts) + the codec round-trip (codec.test.ts);
 * this proves the menu → mutate → repaint wiring against the live app.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "whiteboard-style");

test("whiteboard Style menu recolours a sticky + resizes its text", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-wb-style-"));
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

		// Add a sticky — addNode auto-selects it, so the Style menu's rows enable.
		await wb.locator(".whiteboard__add-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Sticky note" }).click();
		await expect(wb.locator(".whiteboard__node").first()).toBeVisible({ timeout: 10_000 });

		const tint = () =>
			wb
				.locator(".whiteboard__node")
				.first()
				.evaluate((el) => el.style.getPropertyValue("--node-tint"));
		const before = await tint();

		// Recolour: Style ▾ → Fill: Pink.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Fill: Pink" }).click();
		await expect.poll(tint).not.toBe(before);
		expect(await tint()).toBe("#fbcfe8");

		// Resize: Style ▾ → Text: Large.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Text: Large" }).click();
		await expect
			.poll(() =>
				wb
					.locator(".whiteboard__node")
					.first()
					.evaluate((el) => el.style.getPropertyValue("--node-text-size")),
			)
			.toBe("22px");

		// Text colour: Style ▾ → Text colour: Blue.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Text colour: Blue" }).click();
		await expect
			.poll(() =>
				wb
					.locator(".whiteboard__node")
					.first()
					.evaluate((el) => el.style.getPropertyValue("--node-text-color")),
			)
			.toBe("#2563eb");

		// Font: Style ▾ → Font: Mono.
		await wb.locator(".whiteboard__style-trigger").click();
		await wb.locator(".fm-menu .fm-row", { hasText: "Font: Mono" }).click();
		await expect
			.poll(() =>
				wb
					.locator(".whiteboard__node")
					.first()
					.evaluate((el) => el.style.getPropertyValue("--node-font")),
			)
			.not.toBe("");

		await wb.screenshot({ path: join(SCREENSHOT_DIR, "01-styled.png"), fullPage: false });

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
