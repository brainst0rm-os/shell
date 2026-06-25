/**
 * Journal streaks + density heatmap end-to-end smoke (9.16.7).
 *
 * Boots the real shell + seeded vault (the `plan-to-journal.ts` dated entries),
 * opens the Journal, and asserts the sidebar streak badge renders and the
 * mini-calendar paints graduated density dots (`data-density` 1–3) for days
 * with entries — with no renderer console errors. The streak + bucket maths
 * are unit-tested (streaks.test.ts); this proves the live wiring.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "journal-streak");

test("journal renders a streak badge + graduated density dots", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-journal-streak-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);
		const reseed = await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: { dev: { reseedVault: () => Promise<{ ok: boolean; reason?: string }> } };
				}
			).brainstorm;
			return bs.dev.reseedVault();
		});
		expect(reseed.ok, `seed-cli failed: ${reseed.reason ?? ""}`).toBe(true);

		const consoleErrors: string[] = [];
		const trackConsole = (msg: ConsoleMessage) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		};

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.journal"),
		);
		const journal = await waitForAppTabPage(app);
		journal.on("console", trackConsole);
		await journal.waitForLoadState("load", { timeout: 30_000 });
		await journal.waitForSelector(".journal__mini", { state: "visible", timeout: 30_000 });

		// The streak badge always renders (0 → "No active streak"; an active run
		// → "N-day streak"). Its activeness depends on whether the seed's latest
		// entry is consecutive to today, which the scheduler doesn't pin — so we
		// assert it renders + carries a well-formed data-active flag, not a value.
		const badge = journal.locator(".journal__streak");
		await expect(badge).toBeVisible({ timeout: 10_000 });
		const active = await badge.getAttribute("data-active");
		expect(active === "true" || active === "false").toBe(true);

		// Density dots carry a graduated bucket on entry days.
		await expect(journal.locator(".journal__mini-dot").first()).toBeVisible({ timeout: 10_000 });
		const buckets = await journal
			.locator(".journal__mini-dot")
			.evaluateAll((dots) => dots.map((d) => (d as HTMLElement).dataset.density));
		expect(buckets.length).toBeGreaterThanOrEqual(1);
		// Every painted dot carries a 1–3 bucket (0 = no entry → no dot).
		expect(buckets.every((b) => b === "1" || b === "2" || b === "3")).toBe(true);

		await journal.screenshot({ path: join(SCREENSHOT_DIR, "01-streak.png"), fullPage: false });

		expect(
			consoleErrors,
			`unexpected console errors:\n${consoleErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await journal.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
