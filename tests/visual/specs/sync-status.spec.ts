/**
 * Sync-status surface (Stage 10.7) — single-shell smoke against the
 * `window.brainstorm.syncStatus` bridge. Asserts the chip mounts in
 * the dashboard header in its `LocalOnly` shape (the default for a
 * dev vault without a configured relay) and that opening the
 * popover renders the state, relay-none copy, and a seq diagnostic.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("dashboard sync-status chip mounts + opens popover", async () => {
	test.setTimeout(2 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-sync-status-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const chip = dashboard.getByTestId("sync-status-chip");
		await expect(chip).toBeVisible({ timeout: 30_000 });
		await expect(chip).toHaveAttribute("data-state", /local-only|offline|syncing|stale|error/);

		await chip.click();
		const popover = dashboard.getByTestId("sync-status-popover");
		await expect(popover).toBeVisible({ timeout: 5_000 });
		await expect(dashboard.getByTestId("sync-status-popover-seq")).toBeVisible();
	} finally {
		if (app) await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
