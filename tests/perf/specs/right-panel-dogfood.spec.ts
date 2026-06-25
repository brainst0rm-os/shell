/**
 * Dogfooding pass — right-panel (inspector/properties) consistency across apps.
 * NOT a CI gate (kept out of the `kbn-` filter): it launches each app, screenshots
 * the default launch state (to confirm the right panel starts CLOSED — the
 * fixed default-open bug), opens any closed right-panel toggle, and screenshots
 * again so the panels can be compared side by side. Screenshots land in
 * tests/perf/results/right-panel-*.png.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { launchAppPage } from "../../visual/lib/app-window";
import { waitForDashboard } from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

async function openSeededDashboard(page: Page, userDataDir: string): Promise<void> {
	await page.evaluate(
		async ({ d }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							create: (o: { name: string; path: string }) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
					};
				}
			).brainstorm;
			await bs.vaults.create({ name: "right-panel", path: `${d}/vault` });
			await bs.vaults.session();
		},
		{ d: userDataDir },
	);
	await page.reload();
	await waitForDashboard(page);
	await page.evaluate(async () => {
		await (
			window as unknown as { brainstorm: { dev: { seedDemoApps: () => Promise<unknown> } } }
		).brainstorm.dev.seedDemoApps();
	});
}

const APPS = [
	{ id: "io.brainstorm.tasks", label: "tasks" },
	{ id: "io.brainstorm.bookmarks", label: "bookmarks" },
	{ id: "io.brainstorm.books", label: "books" },
	{ id: "io.brainstorm.preview", label: "preview" },
	{ id: "io.brainstorm.notes", label: "notes" },
	{ id: "io.brainstorm.database", label: "database" },
];

test.describe("right-panel dogfood — default-closed + chrome comparison", () => {
	for (const app of APPS) {
		test(`${app.label}: right panel starts closed; opens on toggle`, async () => {
			test.setTimeout(180_000);
			const userDataDir = mkdtempSync(join(tmpdir(), `bs-rp-${app.label}-`));
			try {
				const { app: electron } = await launchShell({ userDataDir, timeoutMs: 120_000 });
				try {
					const dashboard = await electron.firstWindow({ timeout: 60_000 });
					await waitForFirstContentfulPaintAbsoluteMs(dashboard);
					await openSeededDashboard(dashboard, userDataDir);

					const win = await launchAppPage(electron, dashboard, app.id);
					await win.locator(".app-header").first().waitFor({ state: "visible", timeout: 30_000 });
					await win.waitForTimeout(800);

					// Default state — the RIGHT INSPECTOR toggle should report
					// aria-pressed="false". Filter by accessible name (inspector /
					// properties / details) so we don't catch the LEFT sidebar toggle,
					// which also lives in `.app-header__right` (it sits top-right but
					// controls the left pane, so it's legitimately pressed when open).
					const inspectorToggle = win.locator(
						'.app-header__right .bs-panel-toggle[aria-label*="nspector" i], ' +
							'.app-header__right .bs-panel-toggle[aria-label*="ropert" i], ' +
							'.app-header__right .bs-panel-toggle[aria-label*="etail" i], ' +
							'.app-header__right .bs-panel-toggle[aria-label*="info" i]',
					);
					const hasInspectorToggle = (await inspectorToggle.count()) > 0;
					const pressedOnLaunch = hasInspectorToggle
						? await inspectorToggle.first().getAttribute("aria-pressed")
						: "n/a";
					console.log(`[right-panel] ${app.label}: inspector toggle aria-pressed = ${pressedOnLaunch}`);
					await win.screenshot({ path: `tests/perf/results/right-panel-${app.label}-default.png` });

					// Select a first list item if present (populates the panel), then
					// open the inspector and screenshot the open chrome for comparison.
					const firstItem = win
						.locator(
							".db-sidebar__list-item, .dbv-grid__row:not(.dbv-grid__row--head), .bm-row, .task-row, .notes__nav-item, .books__shelf-item",
						)
						.first();
					if (await firstItem.count()) await firstItem.click().catch(() => {});
					if (hasInspectorToggle && pressedOnLaunch === "false") {
						await inspectorToggle
							.first()
							.click()
							.catch(() => {});
						await win.waitForTimeout(500);
					}
					await win.screenshot({ path: `tests/perf/results/right-panel-${app.label}-open.png` });

					// The fix: the right inspector starts CLOSED on a fresh launch.
					if (hasInspectorToggle) {
						expect(pressedOnLaunch, `${app.label} right inspector should start closed`).toBe("false");
					}
				} finally {
					await electron.close().catch(() => {});
				}
			} finally {
				rmSync(userDataDir, { recursive: true, force: true });
			}
		});
	}
});
