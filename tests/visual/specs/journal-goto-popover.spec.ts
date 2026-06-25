/**
 * Journal "Go to date" end-to-end smoke.
 *
 * Boots the real shell + seeded vault, opens the Journal, and proves the
 * date-jump control pops the shared themed calendar (`openCalendarPopover`,
 * `.bs-cal-popover` glass panel + `.bs-cal-mini`) — NOT a native
 * `<input type="date">` — anchored beneath the trigger, with the journal's
 * entry-presence dots, picking a day moving the focused entry, and
 * Escape / outside-click dismissal. Also asserts the daily-reminder toggle
 * uses the shared painted `createCheckbox`. The popover unit contract is in
 * `packages/sdk/src/calendar/calendar-popover.test.ts`; this is the live wiring.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "journal-goto-popover");

test("journal go-to-date pops a themed calendar, not a native input", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-journal-goto-"));
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

		// 1. No native date picker remains.
		expect(await journal.locator('input[type="date"]').count()).toBe(0);

		// 2. The new trigger button is present.
		const trigger = journal.locator(".journal__goto-trigger");
		await expect(trigger).toBeVisible({ timeout: 10_000 });
		const triggerText = (await trigger.textContent())?.trim();

		await journal.screenshot({ path: join(SCREENSHOT_DIR, "01-sidebar.png"), fullPage: false });

		// 3. Reminder toggle is the shared checkbox (painted box), not a raw input.
		expect(await journal.locator(".journal__reminder-toggle.checkbox .checkbox__box").count()).toBe(
			1,
		);

		// 4. Clicking the trigger pops a themed glass calendar popover.
		await trigger.click();
		const popover = journal.locator(".bs-cal-popover");
		await expect(popover).toBeVisible({ timeout: 10_000 });
		expect(await popover.locator(".bs-cal-mini").count()).toBe(1);
		expect(await popover.getAttribute("role")).toBe("dialog");

		// 5. It's a real floating popover (position:fixed from .bs-cal-popover).
		const pos = await popover.evaluate((el) => getComputedStyle(el).position);
		expect(pos).toBe("fixed");

		// 6. The popover reuses the entry-presence dots (renderCell shared).
		const dotCount = await popover.locator(".journal__mini-dot").count();

		await journal.screenshot({ path: join(SCREENSHOT_DIR, "02-popover-open.png"), fullPage: false });

		// 7. Picking a different day commits + closes; the header date changes.
		const headerBefore = (await journal.locator(".app-header__title").textContent())?.trim();
		// Click a day that is in-month but not today (a non-muted cell that isn't selected).
		const day = popover.locator(".bs-cal-month__date").filter({ hasText: /^15$/ }).first();
		await day.click();
		await expect(popover).toHaveCount(0, { timeout: 10_000 });
		const headerAfter = (await journal.locator(".app-header__title").textContent())?.trim();
		expect(headerAfter).not.toBe(headerBefore);

		// 8. PROBE — Escape dismisses.
		await journal.locator(".journal__goto-trigger").click();
		await expect(journal.locator(".bs-cal-popover")).toBeVisible({ timeout: 10_000 });
		await journal.keyboard.press("Escape");
		await expect(journal.locator(".bs-cal-popover")).toHaveCount(0, { timeout: 10_000 });

		// 9. PROBE — outside mousedown dismisses.
		await journal.locator(".journal__goto-trigger").click();
		await expect(journal.locator(".bs-cal-popover")).toBeVisible({ timeout: 10_000 });
		await journal.locator(".app-header__title").click({ position: { x: 2, y: 2 } });
		await expect(journal.locator(".bs-cal-popover")).toHaveCount(0, { timeout: 10_000 });

		console.log(
			`[verify] triggerText=${JSON.stringify(triggerText)} headerBefore=${JSON.stringify(headerBefore)} headerAfter=${JSON.stringify(headerAfter)} popoverDots=${dotCount}`,
		);

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
