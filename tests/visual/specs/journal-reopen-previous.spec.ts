/**
 * Repro (user report 2026-06-17): "opening previous journal entries still does
 * not work — editor is blank". Path reported: the all-entries overview/list.
 *
 * Drives the real Electron shell to reproduce opening a previously-written
 * journal entry from the overview and asserting the day-body editor actually
 * renders that entry's content (not a blank contenteditable). Two phases:
 *
 *   A. Same session (revive path): write a marker into two different days
 *      through the live editor (so the bytes land in the entity's Y.Doc, not
 *      just the `properties.body` snippet), then bounce between them via the
 *      overview and assert each marker re-renders.
 *
 *   B. Fresh session (cold-load-from-disk path): relaunch the shell against
 *      the SAME user-data-dir — every in-memory replica is gone — reopen the
 *      Journal, click a previous entry in the overview, and assert its marker
 *      renders. This is the closest match to "I reopened the app and my old
 *      entries are blank".
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../lib/app-window";
import { launchShell } from "../lib/launch-shell";
import { ensureVaultAndSeed } from "../lib/seed-vault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SHOTS = join(REPO_ROOT, ".screenshots", "journal-reopen-previous");

const TODAY_MARKER = "ZULUMARKERTODAY";
const PREV_MARKER = "YANKEEMARKERPREV";

async function openJournal(app: Awaited<ReturnType<typeof launchShell>>["app"]): Promise<Page> {
	const dashboard = await app.firstWindow({ timeout: 60_000 });
	await dashboard.waitForLoadState("load", { timeout: 60_000 });
	await dashboard.evaluate(() =>
		(
			window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
		).brainstorm.apps.launch("io.brainstorm.journal"),
	);
	const journal = await waitForAppTabPage(app);
	await journal.waitForLoadState("load", { timeout: 30_000 });
	await journal.waitForSelector(".journal__entry-body", { state: "visible", timeout: 30_000 });
	return journal;
}

/** Read the live contenteditable's text (the rendered body), or "" if absent. */
async function editorText(journal: Page): Promise<string> {
	return journal.evaluate(() => document.querySelector(".journal__entry-editor")?.textContent ?? "");
}

test("opening a previously-written journal entry from the overview renders its body", async () => {
	test.setTimeout(8 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-journal-reopen-"));
	try {
		// ── Phase A: write two days through the editor, bounce via overview ──
		{
			const { app } = await launchShell({ userDataDir });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await dashboard.waitForLoadState("load", { timeout: 60_000 });
				await ensureVaultAndSeed(dashboard, userDataDir);

				const journal = await openJournal(app);

				// Today: the seeded welcome entry mounts an editor. Append a marker.
				await journal.waitForSelector(".journal__entry-editor[contenteditable='true']", {
					state: "visible",
					timeout: 30_000,
				});
				await journal.locator(".journal__entry-editor").click();
				await journal.keyboard.press("End");
				await journal.keyboard.type(` ${TODAY_MARKER}`, { delay: 30 });
				await journal.waitForTimeout(900); // past autosave + reproject

				// Previous day: page back one day → empty placeholder → type a marker.
				await journal.getByTestId("app-header").locator(".bs-date-pager__arrow--prev").click();
				const placeholder = journal.locator(".journal__write-placeholder");
				await expect(placeholder).toBeVisible({ timeout: 20_000 });
				await placeholder.click();
				await journal.keyboard.type(PREV_MARKER, { delay: 30 });
				await journal.waitForSelector(".journal__entry-editor[contenteditable='true']", {
					state: "visible",
					timeout: 30_000,
				});
				await journal.waitForTimeout(900);

				// Confirm the prev entry's body rendered where we just typed it.
				expect(await editorText(journal), "prev entry must show its body right after typing").toContain(
					PREV_MARKER,
				);

				// Reported failure: open an entry, leave, RETURN — repeatedly. The
				// "second time" is the suspect (the StrictMode refcount leak pinned
				// the entry so a reopen reused the populated doc → blank), so
				// alternate several round-trips via the overview and assert the body
				// re-renders EVERY time. Navigate by POSITION (newest-first list:
				// today is first, prev is last) so a blank render that empties the
				// preview text can't break the locator.
				const overview = journal.locator(".journal__overview-btn");
				await expect(overview.first()).toBeVisible({ timeout: 20_000 });

				for (let round = 1; round <= 3; round++) {
					await overview.first().click(); // newest-first list → today is first
					await journal.waitForTimeout(900);
					const tText = await editorText(journal);
					await journal.screenshot({ path: join(SHOTS, `A-round${round}-today.png`) });
					expect(tText, `round ${round}: today must render (not blank)`).toContain(TODAY_MARKER);

					await overview.last().click(); // newest-first list → prev is last
					await journal.waitForTimeout(900);
					const pText = await editorText(journal);
					await journal.screenshot({ path: join(SHOTS, `A-round${round}-prev.png`) });
					expect(pText, `round ${round}: prev must render (not blank)`).toContain(PREV_MARKER);
				}
			} finally {
				await app.close().catch(() => {});
			}
		}

		// ── Phase C: SEED-SHAPE entry (body in properties.body, empty Y.Doc) ──
		// The realistic "previous entry": created with a full Lexical body but
		// never typed into, so its Y.Doc starts empty and the first render comes
		// from the seed-plant, not a Yjs snapshot. Open it, leave, RETURN.
		const SEED_MARKER = "XRAYSEEDBODYMARKER";
		{
			const { app } = await launchShell({ userDataDir });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await dashboard.waitForLoadState("load", { timeout: 60_000 });
				const journal = await openJournal(app);

				await journal.evaluate(
					async ({ marker }) => {
						const bs = (
							window as unknown as {
								brainstorm: {
									services: {
										entities: { create: (t: string, p: Record<string, unknown>) => Promise<unknown> };
									};
								};
							}
						).brainstorm;
						const body = {
							root: {
								type: "root",
								format: "",
								indent: 0,
								version: 1,
								direction: "ltr",
								children: [
									{
										type: "paragraph",
										version: 1,
										format: "",
										indent: 0,
										direction: "ltr",
										children: [
											{
												type: "text",
												version: 1,
												text: marker,
												format: 0,
												style: "",
												mode: "normal",
												detail: 0,
											},
										],
									},
								],
							},
						};
						await bs.services.entities.create("io.brainstorm.journal/Entry/v1", {
							title: "2026-06-10",
							body,
						});
					},
					{ marker: SEED_MARKER },
				);
				await journal.waitForTimeout(600);

				const overview = journal.locator(".journal__overview-btn");
				const seedEntry = overview.filter({ hasText: SEED_MARKER }).first();
				await expect(seedEntry).toBeVisible({ timeout: 20_000 });

				for (let round = 1; round <= 3; round++) {
					await seedEntry.click();
					await journal.waitForTimeout(1000);
					await journal.screenshot({ path: join(SHOTS, `C-round${round}-seed.png`) });
					expect(
						await editorText(journal),
						`seed round ${round}: body must render (not blank)`,
					).toContain(SEED_MARKER);
					// Leave to another day so the next click is a genuine RE-open.
					await overview.first().click();
					await journal.waitForTimeout(600);
				}
			} finally {
				await app.close().catch(() => {});
			}
		}

		// ── Phase B: relaunch (fresh replicas) → reopen previous from overview ──
		{
			const { app } = await launchShell({ userDataDir });
			try {
				const journal = await openJournal(app);
				const overview = journal.locator(".journal__overview-btn");
				await expect(overview.first()).toBeVisible({ timeout: 20_000 });

				await overview.filter({ hasText: PREV_MARKER }).first().click();
				await journal.waitForTimeout(1200); // cold load from disk + render
				await journal.screenshot({ path: join(SHOTS, "B1-cold-open-prev.png") });
				expect(
					await editorText(journal),
					"after restart, opening a previous entry from the overview must render its body (cold load)",
				).toContain(PREV_MARKER);
			} finally {
				await app.close().catch(() => {});
			}
		}
	} finally {
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
