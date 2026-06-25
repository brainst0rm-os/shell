/**
 * Comprehensive sub-page repro — seeds MANY notes (closer to the user's
 * vault than an empty one), then exercises the full flow and watches for:
 *  - the page-ref rendering the raw entity id instead of "Untitled",
 *  - the sidebar "jumping all the time" (continuous staleSub refresh loop),
 *  - the open note vanishing / editor remounting on edit.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

type BrainstormGlobal = {
	vaults: {
		list(): Promise<unknown[]>;
		session(): Promise<unknown>;
		create(opts: { name: string; path: string }): Promise<unknown>;
	};
	dev: {
		seedDemoApps(): Promise<void>;
		notes: { createAndOpenScratchNote(): Promise<void> };
	};
};
type BrainstormWindow = { brainstorm: BrainstormGlobal };

const settle = (p: Page) =>
	p.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
	);

test("sub-page: clean name, stable sidebar, clean typing (seeded multi-note vault)", async () => {
	test.setTimeout(300_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-subfull-"));
	const vaultPath = join(userDataDir, "vault");
	const log: string[] = [];
	let refreshCount = 0;
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			launched.app.on("window", (page) => {
				page.on("console", (msg) => {
					const t = msg.text();
					if (t.includes("DIAG-REFRESH")) refreshCount += 1;
					if (/error|pageerror|Minified|selection has been lost/i.test(t))
						log.push(`[con] ${t.slice(0, 160)}`);
				});
			});
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await dashboard.evaluate(
				async ({ vaultPath }) => {
					const bs = (window as unknown as BrainstormWindow).brainstorm;
					const list = await bs.vaults.list();
					let s = await bs.vaults.session();
					if (list.length === 0) {
						await bs.vaults.create({ name: "subfull", path: vaultPath });
						s = await bs.vaults.session();
					}
					if (!s) throw new Error("no session");
					await bs.dev.seedDemoApps();
				},
				{ vaultPath },
			);
			const win = launched.app.waitForEvent("window", { timeout: 30_000 });
			await dashboard.evaluate(() =>
				(window as unknown as BrainstormWindow).brainstorm.dev.notes.createAndOpenScratchNote(),
			);
			const notes = await win;
			await waitForFirstContentfulPaintAbsoluteMs(notes);
			const editable = notes.locator('[contenteditable="true"]').first();
			await editable.waitFor({ state: "visible", timeout: 30_000 });
			await notes.waitForTimeout(1500);
			await settle(notes);

			// Create + open a sub-page.
			await editable.click();
			await settle(notes);
			await notes.evaluate(async () => {
				const dev = (
					window as unknown as {
						__brainstormNotesDev?: { runBlockCommand: (id: string) => Promise<void> };
					}
				).__brainstormNotesDev;
				if (!dev) throw new Error("no dev hook");
				await dev.runBlockCommand("block.embed.subpage");
			});
			await settle(notes);

			const pageRef = notes.locator("a.notes__pageref").first();
			await pageRef.waitFor({ state: "visible", timeout: 15_000 });
			const subId = await pageRef.getAttribute("data-entity-id");
			const pageRefText = (await pageRef.innerText()).trim();
			log.push(`[probe] page-ref text=${JSON.stringify(pageRefText)} subId=${subId}`);

			// === Watch the sidebar for ~4s of IDLE (after creation settles). ===
			refreshCount = 0;
			await notes.waitForTimeout(4000);
			log.push(`[probe] staleSub refreshes during 4s idle = ${refreshCount}`);

			// === Open the sub-page + type in the title. ===
			await pageRef.click();
			await notes.waitForTimeout(1200);
			await settle(notes);
			const subEditable = notes.locator('[contenteditable="true"]').first();
			// Type a word containing a/c/d — the letters that used to trigger
			// block select-all/copy/duplicate (the "Mod+x" chord matching plain
			// keys bug). Must now type literally with no duplication.
			await notes.keyboard.type("abcde", { delay: 150 });
			await notes.waitForTimeout(2000);
			await settle(notes);
			const typed = await subEditable.innerText();
			const editables = await notes.locator('[contenteditable="true"]').count();
			const sidebarItems = await notes.locator("button.notes__sidebar-item").count();
			log.push(
				`[probe] after typing 'abcde': text=${JSON.stringify(typed)} editables=${editables} sidebarItems=${sidebarItems}`,
			);

			for (const l of log) console.log(l);

			expect(pageRefText, `page-ref must not show the raw id (${subId})`).not.toBe(subId);
			expect(editables, "exactly one editor mounted (no remount churn)").toBe(1);
			expect(
				typed.replace(/\n/g, ""),
				`"abcde" must type literally, got ${JSON.stringify(typed)}`,
			).toBe("abcde");
			expect(refreshCount, "sidebar must not refresh continuously when idle").toBeLessThanOrEqual(2);
		} catch (err) {
			for (const l of log) console.log(l);
			throw err;
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
