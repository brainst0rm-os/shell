/**
 * Repro (user report 2026-06-20): "switching rollups in journal in the left
 * menu breaks the editor again" — the periodic-rollup day-body editor renders
 * blank after switching between rollups.
 *
 * Three phases, escalating toward the realistic user action:
 *   A. Seed-only clicking: open each rollup from the left-nav Rollups strip
 *      WITHOUT typing (body is only the synthetic seed), bounce between them,
 *      assert each renders a non-blank body every time. This is the bare
 *      "I clicked around the rollups" path.
 *   B. Typed bodies: append a distinct marker into two rollups through the live
 *      editor, bounce, assert each marker re-renders. Also day → rollup → day.
 *   C. Cold load: relaunch the shell against the SAME user-data-dir (in-memory
 *      replicas gone), reopen Journal, switch rollups, assert bodies render.
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
const SHOTS = join(REPO_ROOT, ".screenshots", "journal-rollup-switch");

const WEEK_MARKER = "WHISKEYWEEKMARKER";
const MONTH_MARKER = "MIKEMONTHMARKER";

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

async function ensureNavOpen(journal: Page): Promise<void> {
	const open = await journal.locator(".journal[data-nav-open='true']").count();
	if (open === 0) {
		await journal.getByTestId("app-header").locator("[aria-controls='journal-nav']").first().click();
	}
	await journal.waitForSelector(".journal__rollup-btn", { state: "visible", timeout: 20_000 });
}

/** Read the live contenteditable's text (the rendered body), or "" if absent. */
async function editorText(journal: Page): Promise<string> {
	return journal.evaluate(() =>
		(document.querySelector(".journal__entry-editor")?.textContent ?? "").trim(),
	);
}

async function clickRollup(journal: Page, index: number): Promise<void> {
	await journal.locator(".journal__rollup-btn").nth(index).click();
	await journal.waitForSelector(".journal__entry-editor", { state: "visible", timeout: 30_000 });
	await journal.waitForTimeout(1000);
}

/** Capture renderer console errors + uncaught page errors — per the dogfood
 *  lesson, the real signal is the console, not just the rendered text. */
function captureErrors(journal: Page): string[] {
	const errors: string[] = [];
	journal.on("console", (msg) => {
		if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
	});
	journal.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
	return errors;
}

test("switching between journal rollups keeps each rollup's editor body rendered", async () => {
	test.setTimeout(6 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-journal-rollup-"));
	try {
		// ── Phase A: seed-only clicking (no typing) ──
		{
			const { app } = await launchShell({ userDataDir });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await dashboard.waitForLoadState("load", { timeout: 60_000 });
				await ensureVaultAndSeed(dashboard, userDataDir);

				const journal = await openJournal(app);
				const errors = captureErrors(journal);
				await ensureNavOpen(journal);

				// Open all four rollups in turn, then bounce between two of them.
				// Each must render a non-blank body (at minimum the seeded period
				// heading) — a blank contenteditable is the reported failure.
				const labels = ["thisWeek", "lastWeek", "thisMonth", "lastMonth"];
				for (let i = 0; i < 4; i++) {
					await clickRollup(journal, i);
					await journal.screenshot({ path: join(SHOTS, `A-open-${labels[i]}.png`) });
					expect(
						(await editorText(journal)).length,
						`first open of ${labels[i]} rollup must render a non-blank body`,
					).toBeGreaterThan(0);
				}

				for (let round = 1; round <= 3; round++) {
					await clickRollup(journal, 0);
					await journal.screenshot({ path: join(SHOTS, `A-round${round}-week.png`) });
					expect(
						(await editorText(journal)).length,
						`round ${round}: re-opened week rollup must render (not blank)`,
					).toBeGreaterThan(0);

					await clickRollup(journal, 2);
					await journal.screenshot({ path: join(SHOTS, `A-round${round}-month.png`) });
					expect(
						(await editorText(journal)).length,
						`round ${round}: re-opened month rollup must render (not blank)`,
					).toBeGreaterThan(0);
				}

				// ── Phase B: typed bodies + day↔rollup ──
				await clickRollup(journal, 0);
				await journal.locator(".journal__entry-editor").click();
				await journal.keyboard.press("End");
				await journal.keyboard.type(` ${WEEK_MARKER}`, { delay: 30 });
				await journal.waitForTimeout(900);
				expect(await editorText(journal), "week rollup must show its typed body").toContain(
					WEEK_MARKER,
				);

				await clickRollup(journal, 2);
				await journal.locator(".journal__entry-editor").click();
				await journal.keyboard.press("End");
				await journal.keyboard.type(` ${MONTH_MARKER}`, { delay: 30 });
				await journal.waitForTimeout(900);
				expect(await editorText(journal), "month rollup must show its typed body").toContain(
					MONTH_MARKER,
				);

				for (let round = 1; round <= 2; round++) {
					await clickRollup(journal, 0);
					expect(await editorText(journal), `B round ${round}: week marker must render`).toContain(
						WEEK_MARKER,
					);
					await clickRollup(journal, 2);
					expect(await editorText(journal), `B round ${round}: month marker must render`).toContain(
						MONTH_MARKER,
					);
				}

				// Day entry → rollup → day entry through the shared island.
				const overview = journal.locator(".journal__overview-btn");
				await expect(overview.first()).toBeVisible({ timeout: 20_000 });
				await overview.first().click();
				await journal.waitForTimeout(1000);
				await journal.screenshot({ path: join(SHOTS, "B-day-after-rollup.png") });
				expect(
					(await editorText(journal)).length,
					"day entry must render a non-empty body after a rollup",
				).toBeGreaterThan(0);

				// ── Phase D: RAPID switching (no settle) — surface the apply/
				// observeDeep race the settled clicks above mask. Fire clicks
				// back-to-back, only settling at the very end, then assert the
				// final rollup rendered and (separately) that switching did not
				// emit renderer errors.
				for (let i = 0; i < 8; i++) {
					await journal
						.locator(".journal__rollup-btn")
						.nth(i % 4)
						.click();
					await journal.waitForTimeout(120);
				}
				await journal.locator(".journal__rollup-btn").nth(0).click();
				await journal.waitForTimeout(1500);
				await journal.screenshot({ path: join(SHOTS, "D-rapid-final-week.png") });
				expect(
					await editorText(journal),
					"after rapid switching, the week rollup must re-render its body (not blank)",
				).toContain(WEEK_MARKER);

				expect(
					errors,
					`renderer emitted errors while switching rollups:\n${errors.join("\n")}`,
				).toEqual([]);
			} finally {
				await app.close().catch(() => {});
			}
		}

		// ── Phase C: cold load (fresh replicas) → switch rollups ──
		{
			const { app } = await launchShell({ userDataDir });
			try {
				const journal = await openJournal(app);
				await ensureNavOpen(journal);

				await clickRollup(journal, 0);
				await journal.screenshot({ path: join(SHOTS, "C-cold-week.png") });
				expect(
					await editorText(journal),
					"cold load: week rollup must render its typed body",
				).toContain(WEEK_MARKER);

				await clickRollup(journal, 2);
				await journal.screenshot({ path: join(SHOTS, "C-cold-month.png") });
				expect(
					await editorText(journal),
					"cold load: month rollup must render its typed body",
				).toContain(MONTH_MARKER);

				await clickRollup(journal, 0);
				await journal.screenshot({ path: join(SHOTS, "C-cold-week-again.png") });
				expect(await editorText(journal), "cold load: switching back to week must re-render").toContain(
					WEEK_MARKER,
				);
			} finally {
				await app.close().catch(() => {});
			}
		}
	} finally {
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
