/**
 * Guard: a Settings → Interface header-control toggle reaches the live
 * dashboard header icons. Runs against a freshly built shell (the main process
 * does NOT HMR, so this is the only honest end-to-end check — a stale
 * `bun run dev` main process would never show the change regardless of the
 * code). Reproduces the dogfood report "I uncheck a control, the checkbox
 * flips, but the header icon never changes".
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("settings → interface checkbox toggles the live header icon (full UI path)", async () => {
	test.setTimeout(3 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-iface-ui-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Dismiss the "What's New" release popover that pops on a fresh launch.
		await dashboard.keyboard.press("Escape").catch(() => {});
		await dashboard.waitForTimeout(500);
		if (
			await dashboard
				.locator(".whats-new-release")
				.isVisible()
				.catch(() => false)
		) {
			await dashboard.keyboard.press("Escape").catch(() => {});
			await dashboard.waitForTimeout(500);
		}

		const binIcon = dashboard.locator('.dashboard__header-right button[aria-label="Open Bin"]');
		await expect(binIcon).toBeVisible({ timeout: 15_000 });

		// Open Settings → Interface.
		await dashboard.locator('.dashboard__header-right button[aria-label="Settings"]').click();
		await dashboard.waitForSelector(".settings__nav", { state: "visible", timeout: 15_000 });
		await dashboard.locator(".settings__nav-item", { hasText: "Interface" }).first().click();

		const binCheckbox = dashboard.locator('input[type="checkbox"][aria-label="Bin"]');
		await expect(binCheckbox).toBeVisible({ timeout: 15_000 });
		await expect(binCheckbox).toBeChecked();

		// Click the row label (what the user actually clicks — the input is
		// visually hidden behind the painted .checkbox__box).
		await dashboard.locator("label.setting-row", { has: binCheckbox }).click();
		await expect(binCheckbox).not.toBeChecked({ timeout: 5_000 });

		// Close settings; the live header icon must now be gone.
		await dashboard.keyboard.press("Escape");
		await expect(binIcon).toBeHidden({ timeout: 10_000 });

		// And toggling it back on restores the icon.
		await dashboard.locator('.dashboard__header-right button[aria-label="Settings"]').click();
		await dashboard.waitForSelector(".settings__nav", { state: "visible", timeout: 15_000 });
		await dashboard.locator(".settings__nav-item", { hasText: "Interface" }).first().click();
		await dashboard.locator("label.setting-row", { has: binCheckbox }).click();
		await expect(binCheckbox).toBeChecked({ timeout: 5_000 });
		await dashboard.keyboard.press("Escape");
		await expect(binIcon).toBeVisible({ timeout: 10_000 });
	} finally {
		await app?.close().catch(() => {});
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
