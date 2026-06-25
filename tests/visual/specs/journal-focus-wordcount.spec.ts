/**
 * Journal create-focus + live word-count verification (2026-06-07).
 *
 * Drives the real Electron shell to verify three fixes to the Journal
 * day-body save/render loop:
 *
 *   1. Creating today's entry by typing into the empty-day placeholder
 *      KEEPS focus in the mounted editor across the autosave + vault
 *      reproject window (the old bug: the async `vaultEntities.onChange`
 *      reproject repainted `mainPanel` and tore the editor host out of the
 *      DOM mid-type, dropping the caret).
 *
 *   2. Continued typing does NOT trigger a focus-stealing full reproject
 *      (the reproject is now coalesced + deferred while the editor is
 *      focused) — observed as "focus stays inside the editor host".
 *
 *   3. The "N words" readout updates LIVE while typing, before any blur
 *      (the old readout was a static snapshot painted only on reproject,
 *      which the editor-busy guard skips while you type).
 *
 * `seedDemoApps` plants a welcome entry on today, so we first delete every
 * journal entry to leave today empty — that surfaces the implicit-create
 * placeholder, the exact path under test.
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
const SCREENSHOT_DIR = join(REPO_ROOT, ".screenshots", "journal-focus-wordcount");
const JOURNAL_ENTRY_TYPE = "io.brainstorm.journal/Entry/v1";

function parseWordCount(metaText: string): number | null {
	const m = metaText.match(/(\d+)\s+words?/);
	return m?.[1] ? Number(m[1]) : null;
}

test("journal new entry keeps focus + word count updates live while typing", async () => {
	test.setTimeout(5 * 60 * 1000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-journal-focus-"));
	const { app } = await launchShell({ userDataDir });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

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
		await journal.waitForLoadState("load", { timeout: 30_000 });
		await journal.waitForSelector(".journal__entry-body", { state: "visible", timeout: 30_000 });

		// Today opens with a seeded welcome entry — delete every journal entry
		// so today goes empty and shows the implicit-create placeholder.
		const deletedIds = await journal.evaluate(async (typeId) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						services: {
							vaultEntities: { list: () => Promise<{ entities: Array<Record<string, unknown>> }> };
							entities: { delete: (id: string) => Promise<unknown> };
						};
					};
				}
			).brainstorm;
			const snap = await bs.services.vaultEntities.list();
			const ids = (snap.entities ?? [])
				.filter((e) => e.type === typeId && !e.deletedAt)
				.map((e) => e.id as string);
			for (const id of ids) await bs.services.entities.delete(id);
			return ids;
		}, JOURNAL_ENTRY_TYPE);
		expect(deletedIds.length, "expected a seeded journal entry to delete").toBeGreaterThan(0);

		// The welcome editor may hold autofocus, which (correctly) defers the
		// reproject. Blur it so the delete's reproject runs and the placeholder
		// paints.
		await journal.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

		const placeholder = journal.locator(".journal__write-placeholder");
		await expect(placeholder, "empty-today placeholder must appear after delete").toBeVisible({
			timeout: 20_000,
		});
		await journal.screenshot({ path: join(SCREENSHOT_DIR, "01-empty-today.png") });

		// Watch console only for the actual create/type flow under test — the
		// pre-flow delete (harness scaffolding) tears down the welcome editor's
		// live Y.Doc binding and logs a Lexical error that isn't our concern.
		journal.on("console", trackConsole);

		// --- The create path: first input mints the entry, editor mounts ---
		await placeholder.click();
		await journal.keyboard.type("alpha", { delay: 45 });
		await journal.waitForSelector(".journal__entry-editor[contenteditable='true']", {
			state: "visible",
			timeout: 30_000,
		});
		await journal.screenshot({ path: join(SCREENSHOT_DIR, "02-editor-mounted.png") });

		// FIX #1/#2: hold past the reproject window (250ms debounce + 200ms
		// autosave + the create-echo onChange). The old bug tore the editor
		// host out here and dropped focus.
		await journal.waitForTimeout(900);
		const afterCreate = await journal.evaluate(() => {
			const host = document.querySelector(".journal__entry-editor-host");
			const active = document.activeElement;
			return {
				inEditor: !!host && !!active && host.contains(active),
				activeClass: active?.className ?? "(none)",
				meta: document.querySelector(".journal__entry-meta")?.textContent ?? "",
			};
		});
		expect(
			afterCreate.inEditor,
			`focus must stay in the editor after create; active was "${afterCreate.activeClass}"`,
		).toBe(true);
		const countAfterCreate = parseWordCount(afterCreate.meta);
		expect(
			countAfterCreate,
			`word count must render after create; meta was "${afterCreate.meta}"`,
		).not.toBeNull();

		// FIX #3 (+ #1/#2 again): keep typing into the focused editor. The
		// count must climb LIVE and focus must never leave.
		await journal.keyboard.type(" beta gamma delta epsilon", { delay: 45 });
		await journal.waitForTimeout(700);
		const after = await journal.evaluate(() => {
			const host = document.querySelector(".journal__entry-editor-host");
			const active = document.activeElement;
			return {
				inEditor: !!host && !!active && host.contains(active),
				meta: document.querySelector(".journal__entry-meta")?.textContent ?? "",
				body: document.querySelector(".journal__entry-body")?.textContent ?? "",
			};
		});
		await journal.screenshot({ path: join(SCREENSHOT_DIR, "03-after-typing.png") });

		expect(after.inEditor, "focus must STILL be in the editor after typing more").toBe(true);
		const countAfter = parseWordCount(after.meta);
		expect(countAfter, `live word count must render; meta was "${after.meta}"`).not.toBeNull();
		expect(
			countAfter ?? 0,
			`word count must update live (was ${countAfterCreate}, now ${countAfter}); meta="${after.meta}"`,
		).toBeGreaterThan(countAfterCreate ?? 0);
		expect(after.body.toLowerCase(), "typed text must land in the body").toContain("beta");

		// The pre-flow delete tears down the welcome entry's still-open Y.Doc
		// binding, which logs a single Lexical #75 (reconciliation) error from
		// that teardown — harness scaffolding, not the create/type flow. Gate
		// on everything ELSE.
		const flowErrors = consoleErrors.filter((e) => !/Lexical error #75/.test(e));
		expect(
			flowErrors,
			`unexpected console errors during create/type flow:\n${flowErrors.map((e) => `  - ${e}`).join("\n")}`,
		).toEqual([]);

		await journal.close().catch(() => {});
	} finally {
		await app.close().catch(() => {});
		if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
	}
});
