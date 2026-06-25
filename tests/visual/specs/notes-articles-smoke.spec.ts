/**
 * Notes app seeded-articles smoke. Verifies the dogfood articles
 * (`tools/mcp-server/src/seed/feature-articles.ts`) reach the running
 * shell after `dev.reseedVault()`:
 *
 *   1. The seed-cli writes them to `<vault>/data/apps/io.brainstorm.notes/kv.json`.
 *   2. The kv→entities backfill lands them in `entities.db` as
 *      `io.brainstorm.notes/Note/v1` rows.
 *   3. The Notes app's `vaultEntities.list()` returns them by id.
 *   4. The Notes sidebar renders a non-empty list.
 *
 * We don't assert visible-in-DOM article titles — the sidebar is
 * virtualised and articles land far past the today-section by their
 * `STABLE_TS = 2026-05-14` updatedAt. Scrolling that list reliably in
 * Playwright is brittle; the entity-level + non-empty checks pin the
 * load-bearing contract without UI flake.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const EXPECTED_ARTICLE_IDS = ["article-welcome", "article-why-crdts", "article-journal-guide"];

test("seeded feature-articles reach entities.db AND Notes' read path", async () => {
	test.setTimeout(3 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-notes-articles-"));
	let app: ElectronApplication | null = null;
	try {
		const launched = await launchShell({ userDataDir });
		app = launched.app;
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const reseed = await dashboard.evaluate(async () => {
			const bs = (
				window as unknown as {
					brainstorm: {
						dev: { reseedVault: () => Promise<{ ok: boolean; reason?: string }> };
					};
				}
			).brainstorm;
			return bs.dev.reseedVault();
		});
		expect(reseed.ok, `reseed failed: ${reseed.reason ?? ""}`).toBe(true);

		await dashboard.evaluate(() =>
			(
				window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
			).brainstorm.apps.launch("io.brainstorm.notes"),
		);
		const notes = await waitForAppTabPage(app);
		await notes.waitForLoadState("load", { timeout: 30_000 });
		// Wait for the Notes sidebar to populate (it depends on
		// `vaultEntities.list()` returning + the boot-time migration
		// kicking off without blocking).
		await notes.waitForSelector(".notes__sidebar-list", { timeout: 30_000 });
		await notes.waitForTimeout(3_000);

		const probe = await notes.evaluate(async (ids: string[]) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						services: {
							vaultEntities: {
								list: () => Promise<{ entities: Array<{ id: string; type: string }> }>;
							};
						};
					};
				}
			).brainstorm;
			const snap = await bs.services.vaultEntities.list();
			const present = ids.filter((id) => snap.entities.some((e) => e.id === id));
			return {
				totalEntities: snap.entities.length,
				articlesFound: present,
				sidebarRowCount: document.querySelectorAll(".notes__sidebar-item").length,
			};
		}, EXPECTED_ARTICLE_IDS);
		console.log("[notes-articles-smoke] PROBE", JSON.stringify(probe, null, 2));

		expect(probe.articlesFound, "all 3 articles must be queryable in entities.db").toEqual(
			EXPECTED_ARTICLE_IDS,
		);
		expect(
			probe.sidebarRowCount,
			"Notes sidebar must render rows (no Loading… stall)",
		).toBeGreaterThan(0);
	} finally {
		if (app) await app.close().catch(() => {});
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
