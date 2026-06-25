/**
 * Repro — editing a note used to yank it to the top of the sidebar (jump
 * across date buckets) on every keystroke. The open note's sort position is
 * now frozen while it stays selected. Two notes; select the OLDER one and
 * edit it — it must NOT jump above the newer one while being edited.
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

async function newScratch(
	dashboard: Page,
	app: Awaited<ReturnType<typeof launchShell>>["app"],
): Promise<Page> {
	const win = app.waitForEvent("window", { timeout: 30_000 }).catch(() => null);
	await dashboard.evaluate(() =>
		(window as unknown as BrainstormWindow).brainstorm.dev.notes.createAndOpenScratchNote(),
	);
	const w = await win;
	return (w as Page) ?? dashboard;
}

test("editing the open note does not reorder it in the sidebar", async () => {
	test.setTimeout(240_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-sbstable-"));
	const vaultPath = join(userDataDir, "vault");
	const log: string[] = [];
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await dashboard.evaluate(
				async ({ vaultPath }) => {
					const bs = (window as unknown as BrainstormWindow).brainstorm;
					const list = await bs.vaults.list();
					let s = await bs.vaults.session();
					if (list.length === 0) {
						await bs.vaults.create({ name: "sbst", path: vaultPath });
						s = await bs.vaults.session();
					}
					if (!s) throw new Error("no session");
					await bs.dev.seedDemoApps();
				},
				{ vaultPath },
			);

			// Note 1 → "FirstNote"
			const notes = await newScratch(dashboard, launched.app);
			await waitForFirstContentfulPaintAbsoluteMs(notes);
			let editable = notes.locator('[contenteditable="true"]').first();
			await editable.waitFor({ state: "visible", timeout: 30_000 });
			await settle(notes);
			await editable.click();
			await notes.keyboard.type("FirstNote", { delay: 60 });
			await notes.waitForTimeout(900);

			// Note 2 → "SecondNote" (reuses the same window via openEntity)
			await dashboard.evaluate(() =>
				(window as unknown as BrainstormWindow).brainstorm.dev.notes.createAndOpenScratchNote(),
			);
			await notes.waitForTimeout(1200);
			await settle(notes);
			editable = notes.locator('[contenteditable="true"]').first();
			await editable.click();
			await notes.keyboard.type("SecondNote", { delay: 60 });
			await notes.waitForTimeout(1200);
			await settle(notes);

			const orderBefore = await notes.locator("button.notes__sidebar-item").allInnerTexts();
			log.push(`[probe] sidebar order before editing FirstNote: ${JSON.stringify(orderBefore)}`);

			// Select the OLDER note (FirstNote) from the sidebar and edit it.
			const firstRow = notes.locator("button.notes__sidebar-item", { hasText: "FirstNote" }).first();
			await firstRow.click();
			await notes.waitForTimeout(1000);
			await settle(notes);
			editable = notes.locator('[contenteditable="true"]').first();
			await editable.click();
			await notes.keyboard.press("End");
			await notes.keyboard.type("Z", { delay: 60 });
			await notes.waitForTimeout(1500);
			await settle(notes);

			const orderAfter = await notes.locator("button.notes__sidebar-item").allInnerTexts();
			log.push(`[probe] sidebar order after editing FirstNote: ${JSON.stringify(orderAfter)}`);

			for (const l of log) console.log(l);

			const idxFirst = orderAfter.findIndex((t) => t.includes("FirstNote"));
			const idxSecond = orderAfter.findIndex((t) => t.includes("SecondNote"));
			expect(idxFirst, "FirstNote should still be present").toBeGreaterThanOrEqual(0);
			expect(idxSecond, "SecondNote should still be present").toBeGreaterThanOrEqual(0);
			// Frozen: the note being edited (FirstNote) stays BELOW SecondNote
			// instead of jumping to the top.
			expect(idxFirst, "edited note must not jump above the newer note").toBeGreaterThan(idxSecond);
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
