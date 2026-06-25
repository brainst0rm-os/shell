/**
 * Seeded-note open — verifies the seeder's new on-disk shape (per-note
 * `.ydoc` snapshot + plain-text snippet in kv.json) actually reaches the
 * editor. Counterpart to `repro-note-loss.spec.ts`: that spec catches
 * regressions on the user-typed reopen path; this one catches
 * regressions on the seeded-from-source path (the apps' demo data, the
 * BrainstormProject plan→notes seeding, iteration / design-doc / article
 * notes).
 *
 * Flow:
 *  1. Boot shell + create vault.
 *  2. Call `bs.dev.reseedVault()` — runs the seed-cli which now writes
 *     `.ydoc` files alongside each note's kv row.
 *  3. Open Notes; click a known seeded note (the release hub note has a
 *     deterministic id from `plan-to-hub.ts`).
 *  4. Assert the editor renders real content (not empty + not the
 *     "[object Object]" stringification that an unparsed XmlText would
 *     show).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

async function ensureVaultSeeded(dashboard: Page, vaultPath: string): Promise<void> {
	await dashboard.evaluate(
		async ({ vaultPath }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<unknown[]>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: {
							seedDemoApps: () => Promise<unknown>;
							reseedVault: () => Promise<unknown>;
						};
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			if (list.length === 0) {
				await bs.vaults.create({ name: "seed-fixture", path: vaultPath });
			}
			await bs.dev.seedDemoApps();
			await bs.dev.reseedVault();
		},
		{ vaultPath },
	);
}

async function openNotes(
	dashboard: Page,
	app: Awaited<ReturnType<typeof launchShell>>["app"],
): Promise<Page> {
	const newWindow = app.waitForEvent("window", { timeout: 30_000 });
	await dashboard.evaluate(() =>
		(
			window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
		).brainstorm.apps.launch("io.brainstorm.notes"),
	);
	const win = await newWindow;
	await waitForFirstContentfulPaintAbsoluteMs(win);
	return win;
}

test("seeded notes render content immediately on open", async () => {
	test.setTimeout(300_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-seeded-open-"));
	const vaultPath = join(userDataDir, "vault");
	const consoleLog: string[] = [];
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			launched.app.on("window", (page) => {
				page.on("console", (msg: ConsoleMessage) => {
					consoleLog.push(`[${msg.type()}] ${msg.text()}`);
				});
			});
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			dashboard.on("console", (msg) => consoleLog.push(`[dashboard/${msg.type()}] ${msg.text()}`));
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultSeeded(dashboard, vaultPath);

			const notes = await openNotes(dashboard, launched.app);

			// Pick the first note row (sidebar shows whatever seed.reseedVault
			// produced — at least iteration / docs / hub notes). Clicking it
			// mounts the editor; if the seeded .ydoc is correct, content
			// renders without any migration step.
			const firstRow = notes.locator("button.notes__sidebar-item").first();
			await firstRow.waitFor({ state: "visible", timeout: 30_000 });
			await firstRow.click();

			const editable = notes.locator('[contenteditable="true"]').first();
			await editable.waitFor({ state: "visible", timeout: 30_000 });
			// Give the Y.Doc load + bind enough time.
			await notes.waitForTimeout(2000);

			const text = await editable.innerText();
			const html = await editable.evaluate((el) => (el as HTMLElement).outerHTML.slice(0, 600));

			if (text.trim().length === 0 || /\[object Object\]/.test(text)) {
				console.log("========== SEEDED-OPEN LOG ==========");
				for (const l of consoleLog) console.log(l);
				console.log(`---\ntext=${JSON.stringify(text)}\nhtml=${html}`);
				console.log("=====================================");
			}

			expect(text.trim().length, `seeded note rendered empty; html=${html}`).toBeGreaterThan(0);
			expect(text, "seeded body contains '[object Object]' stringification artifact").not.toMatch(
				/\[object Object\]/,
			);
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
