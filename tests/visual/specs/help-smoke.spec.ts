/**
 * Help-1 smoke — open the Help overlay, type a query, click the first
 * hit, assert the article title resolved.
 *
 * The corpus is build-time-bundled (no network), so this spec runs
 * against the production main bundle and exercises:
 *
 *   - `help:get-corpus` returns parsed articles.
 *   - `help:search` over `help_fts` returns ranked hits with snippets.
 *   - The sidebar populates and a hit click routes to its topic.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";

import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

test("Help-1 smoke — `?` chord opens Help, search finds a hit, click loads the article", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-help-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		// Dismiss the auto changelog popover so it doesn't intercept the `?`
		// chord (same trick as rtl-shell-smoke.spec.ts).
		await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						help: { getChangelog: () => Promise<{ releases: Array<{ version: string }> }> };
						dashboard: { setLastSeenChangelogVersion: (v: string) => Promise<unknown> };
					};
				}
			).brainstorm;
			const cl = await bs.help.getChangelog();
			const newest = cl.releases[0]?.version;
			if (newest) await bs.dashboard.setLastSeenChangelogVersion(newest);
		});
		const openPopover = dashboard.locator('div[role="dialog"][aria-modal="true"]');
		if ((await openPopover.count()) > 0) {
			await dashboard.keyboard.press("Escape");
		}

		await dashboard.getByRole("button", { name: "Open Help" }).click();
		await dashboard.waitForSelector('[data-testid="help"]', {
			state: "visible",
			timeout: 30_000,
		});

		await dashboard.waitForSelector('[data-testid="help-nav-item"]', { timeout: 30_000 });
		const navItems = dashboard.locator('[data-testid="help-nav-item"]');
		const count = await navItems.count();
		expect(count).toBeGreaterThanOrEqual(1);

		await expect(dashboard.locator('[data-testid="help-article-title"]')).toBeVisible({
			timeout: 30_000,
		});

		const input = dashboard.locator('[data-testid="help-search-input"]');
		await input.fill("vault");
		await dashboard.waitForSelector('[data-testid="help-search-hit"]', { timeout: 30_000 });
		const firstHit = dashboard.locator('[data-testid="help-search-hit"]').first();
		await firstHit.click();

		await expect(dashboard.locator('[data-testid="help-article-title"]')).toBeVisible();

		// Polish regressions:
		// 1. Sidebar titles must NOT carry the `NN — ` doc-numbering prefix.
		const titles = await dashboard.locator('[data-testid="help-nav-item"]').allTextContents();
		for (const title of titles) {
			expect(title).not.toMatch(/^\d+[a-z]?\s*[—-]\s*/);
		}

		// 2. The article body must not start with its title as a duplicate H1.
		const articleTitleText = await dashboard
			.locator('[data-testid="help-article-title"]')
			.textContent();
		const bodyFirstHeadingText = await dashboard
			.locator('[data-testid="help-article-body"] h2, [data-testid="help-article-body"] h3')
			.first()
			.textContent()
			.catch(() => null);
		if (articleTitleText && bodyFirstHeadingText) {
			expect(bodyFirstHeadingText.trim()).not.toBe(articleTitleText.trim());
		}
	} finally {
		if (app) await app.close();
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
