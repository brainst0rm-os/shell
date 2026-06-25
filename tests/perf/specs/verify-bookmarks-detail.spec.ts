/**
 * Real-shell verification of Bookmarks 9.18.7 — bookmark detail view + body
 * editor. The unit tests cover the component; this proves the open-verb path
 * works end-to-end in the production shell: opening a seeded bookmark mounts
 * the `.bm-detail` sheet with the Lexical body editor (`.bm-detail__editor`).
 * NOT a CI gate (outside the `kbn-` filter); a dogfooding/verify aid.
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
			await bs.vaults.create({ name: "verify-bm", path: `${d}/vault` });
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

test.describe("verify — Bookmarks 9.18.7 detail view + body editor", () => {
	test("opening a bookmark mounts the detail sheet with the body editor", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-verify-bm-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const bm = await launchAppPage(app, dashboard, "io.brainstorm.bookmarks");
				await bm.locator(".bookmarks__nav").first().waitFor({ state: "visible", timeout: 30_000 });

				// Compose a bookmark via the real user path, then open it.
				await bm
					.getByRole("button", { name: /add bookmark/i })
					.first()
					.click();
				await bm.locator(".bookmarks__form").waitFor({ state: "visible", timeout: 10_000 });
				await bm.locator(".bookmarks__form-input").first().fill("https://example.com/verify");
				// The footer (submit/cancel) is the popover's footer slot — a sibling
				// of `.bookmarks__form`, not a child — so target it at page level.
				await bm.locator('.bookmarks__form-footer button[type="submit"]').click();

				const card = bm.locator(".bookmarks__card").first();
				await card.waitFor({ state: "visible", timeout: 15_000 });

				// Open it (the title button is the a11y open path).
				await bm.locator(".bookmarks__card-title").first().click();

				// The detail sheet mounts with the Lexical body editor.
				await expect(bm.locator(".bm-detail")).toBeVisible({ timeout: 15_000 });
				const editor = bm.locator(".bm-detail__editor");
				await expect(editor).toBeVisible({ timeout: 15_000 });
				await expect(editor).toHaveAttribute("contenteditable", "true");

				console.log("[verify] bookmarks 9.18.7: detail sheet + body editor mount on open");
				await bm.screenshot({ path: "tests/perf/results/verify-bookmarks-detail.png" });
			} finally {
				await app.close().catch(() => {});
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});

	test("the demo-seeded bookmark surfaces in the app (savedAt codec/seed fix)", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-verify-bm-seed-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const bm = await launchAppPage(app, dashboard, "io.brainstorm.bookmarks");
				await bm.locator(".bookmarks__nav").first().waitFor({ state: "visible", timeout: 30_000 });

				// The welcome-seeded "Brainstorm — help & docs" Bookmark/v1 (no
				// `savedAt`) used to be dropped by the codec → invisible in the app
				// though Database/Graph showed it. After the fix (codec defaults
				// savedAt←createdAt + the seed sets savedAt) it surfaces as a card.
				const seededCard = bm
					.locator(".bookmarks__card")
					.filter({ hasText: "Brainstorm — help & docs" });
				await expect(seededCard.first()).toBeVisible({ timeout: 30_000 });

				console.log("[verify] bookmarks: demo-seeded bookmark now surfaces in the app");
				await bm.screenshot({ path: "tests/perf/results/verify-bookmarks-seeded.png" });
			} finally {
				await app.close().catch(() => {});
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
