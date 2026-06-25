/**
 * Calendar polish verification (real shell) — exercises the design work:
 *
 *  - the range title now lives in the shell `.app-header` (left group,
 *    after the back/forward nav buttons), not in a second toolbar strip;
 *  - the view-kind tabs + New event sit in `.app-header__right`;
 *  - Week / Day views render one clickable hour slot per hour and
 *    clicking an empty slot opens the create surface at that hour;
 *  - the Journal sidebar uses the SAME shared `.bs-cal-mini` widget the
 *    Calendar app uses.
 *
 * Captures screenshots into tests/perf/results/polish/ for visual review.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

const CALENDAR_APP = "io.brainstorm.calendar";
const JOURNAL_APP = "io.brainstorm.journal";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "results", "polish");

async function ensureVaultAndSeed(dashboard: Page, userDataDir: string): Promise<void> {
	await dashboard.evaluate(
		async ({ userDataDir }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<unknown[]>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							activate: (id: string) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: { seedDemoApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "calendar-polish", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("calendar polish: no active vault after setup");
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

async function openApp(
	dashboard: Page,
	app: Awaited<ReturnType<typeof launchShell>>["app"],
	appId: string,
): Promise<Page> {
	const newWindow = app.waitForEvent("window", { timeout: 30_000 });
	await dashboard.evaluate(
		(id) =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch(id),
		appId,
	);
	const win = await newWindow;
	await waitForFirstContentfulPaintAbsoluteMs(win);
	return win;
}

test("Calendar polish: header title, week/day slots, journal shared widget", async () => {
	mkdirSync(SHOTS, { recursive: true });
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-cal-polish-"));
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			const cal = await openApp(dashboard, app, CALENDAR_APP);

			// Title is in the shell header's left group (after the nav buttons),
			// not in a separate toolbar.
			const title = cal.locator(".app-header__left .cal-toolbar__range");
			await expect(title).toBeVisible({ timeout: 10_000 });
			expect((await title.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
			// View tabs live in the header's right group.
			await expect(
				cal.locator(".app-header__right .cal-toolbar__tab[data-view='week']"),
			).toBeVisible();
			await cal.screenshot({ path: join(SHOTS, "calendar-month.png") });

			// Week view: 7 days × 24 hour slots.
			await cal.locator(".cal-toolbar__tab[data-view='week']").click();
			await expect(cal.locator(".cal-week").first()).toBeVisible({ timeout: 10_000 });
			expect(await cal.locator(".cal-week__slot").count()).toBe(24 * 7);
			await cal.screenshot({ path: join(SHOTS, "calendar-week.png") });

			// Clicking an empty hour slot opens the create surface.
			await cal.locator(".cal-week__column").first().locator(".cal-week__slot").nth(9).click();
			await expect(cal.locator(".cal-detail").first()).toBeVisible({ timeout: 10_000 });
			await cal.screenshot({ path: join(SHOTS, "calendar-create-at-hour.png") });
			await cal.keyboard.press("Escape");

			// Day view.
			await cal.locator(".cal-toolbar__tab[data-view='day']").click();
			await expect(cal.locator(".cal-week[data-kind='day']").first()).toBeVisible({
				timeout: 10_000,
			});
			await cal.screenshot({ path: join(SHOTS, "calendar-day.png") });
			await cal.close();

			// Journal: sidebar uses the shared mini-calendar.
			const journal = await openApp(dashboard, app, JOURNAL_APP);
			await expect(journal.locator(".journal__nav .bs-cal-mini").first()).toBeVisible({
				timeout: 10_000,
			});
			await journal.screenshot({ path: join(SHOTS, "journal-sidebar.png") });
			await journal.close();
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
