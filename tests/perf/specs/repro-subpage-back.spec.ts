/**
 * Repro probe — user reported that creating a sub-page and then clicking
 * "back" shows a blank document, and that sub-pages don't work.
 *
 * Drives the sub-page command through the renderer dev hook
 * (`__brainstormNotesDev.runBlockCommand`) rather than synthetic
 * keystrokes: `keyboard.type` into a Yjs-collab editor in headless
 * Electron drops/duplicates characters and corrupts the tree, which is a
 * harness artifact unrelated to the bug under test. The dev hook exercises
 * the REAL editor + collab binding + the actual command.
 *
 *   1. create + open a scratch note (parent A)
 *   2. run the sub-page command → creates note B + a page-ref in A
 *   3. click the page-ref → should open B (no crash, sub-page works)
 *   4. click nav-back → should return to A with the page-ref intact (not blank)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

async function ensureVaultCreated(dashboard: Page, vaultPath: string): Promise<void> {
	await dashboard.evaluate(
		async ({ vaultPath }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<unknown[]>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							activate: (id: string) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: { seedDemoApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "repro-fixture", path: vaultPath });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("repro harness: no active vault after setup");
			await bs.dev.seedDemoApps();
		},
		{ vaultPath },
	);
}

const settle = (p: Page) =>
	p.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);

test("repro — create sub-page, open it, click back, parent keeps its page-ref", async () => {
	test.setTimeout(300_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-repro-subpage-"));
	const vaultPath = join(userDataDir, "vault");
	const consoleLog: string[] = [];
	const editorErrors: string[] = [];
	const dump = (): void => {
		console.log("\n========== SUBPAGE REPRO LOG ==========");
		for (const line of consoleLog) console.log(line);
		console.log("=======================================\n");
	};
	const track = (text: string): void => {
		consoleLog.push(text);
		if (text.includes("[notes/editor]") && text.includes("error")) editorErrors.push(text);
		if (text.includes("Lexical error")) editorErrors.push(text);
	};
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			launched.app.on("window", (page) => {
				const tag = page.url().slice(-24);
				page.on("console", (msg) => track(`[${tag}/${msg.type()}] ${msg.text()}`));
				page.on("pageerror", (err) => track(`[${tag}/pageerror] ${err.message}`));
			});
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			dashboard.on("console", (msg) => track(`[dash/${msg.type()}] ${msg.text()}`));
			launched.app.on("console", (msg) => track(`[main/${msg.type()}] ${msg.text()}`));
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultCreated(dashboard, vaultPath);

			// === Create + open a scratch note (parent A) ===
			const newWindow = launched.app.waitForEvent("window", { timeout: 30_000 });
			const scratch = await dashboard.evaluate(async () => {
				const bs = (
					window as unknown as {
						brainstorm: {
							dev: {
								notes: {
									createAndOpenScratchNote: () => Promise<
										{ ok: true; entityId: string } | { ok: false; reason: string }
									>;
								};
							};
						};
					}
				).brainstorm;
				return bs.dev.notes.createAndOpenScratchNote();
			});
			if (!scratch.ok) throw new Error(`createAndOpenScratchNote failed: ${scratch.reason}`);
			const parentId = scratch.entityId;
			const notes = await newWindow;
			await waitForFirstContentfulPaintAbsoluteMs(notes);

			const editable = notes.locator('[contenteditable="true"]').first();
			await editable.waitFor({ state: "visible", timeout: 30_000 });
			await settle(notes);

			// Give the parent distinct, recognizable body content (programmatic
			// — synthetic keystrokes corrupt the collab editor in headless
			// Electron).
			const PARENT_MARK = "parent-body-survives-roundtrip-XYZ";
			await notes.evaluate(async (text) => {
				const dev = (
					window as unknown as {
						__brainstormNotesDev?: { appendParagraph: (t: string) => Promise<void> };
					}
				).__brainstormNotesDev;
				if (!dev) throw new Error("__brainstormNotesDev missing");
				await dev.appendParagraph(text);
			}, PARENT_MARK);
			await notes.waitForTimeout(1200); // let the body update persist
			await settle(notes);
			const parentBodyBefore = await editable.innerText();
			track(`[probe] parent body before nav: ${JSON.stringify(parentBodyBefore)}`);
			expect(parentBodyBefore, "parent should contain its body content").toContain(PARENT_MARK);

			// === Insert a sub-page via the dev hook, which replicates the
			// slash menu's activate() exactly (clear caret block + selectStart,
			// then run the command). Synthetic keystrokes corrupt the collab
			// editor and race the menu's fuzzy match in headless Electron
			// ("/sub" fuzzy-matches heading2/heading3 too), so they can't
			// reliably target the sub-page command. ===
			await editable.click();
			await settle(notes);
			await notes.evaluate(async () => {
				const dev = (
					window as unknown as {
						__brainstormNotesDev?: { runBlockCommand: (id: string) => Promise<void> };
					}
				).__brainstormNotesDev;
				if (!dev) throw new Error("__brainstormNotesDev missing");
				await dev.runBlockCommand("block.embed.subpage");
			});
			await settle(notes);

			const pageRef = notes.locator("a.notes__pageref").first();
			await pageRef.waitFor({ state: "visible", timeout: 15_000 });
			const subPageId = await pageRef.getAttribute("data-entity-id");
			track(`[probe] parent=${parentId} sub-page=${subPageId}`);
			expect(subPageId, "sub-page should have a distinct entity id").not.toBe(parentId);
			await notes.waitForTimeout(800);
			const parentAfterInsert = await editable.innerText();
			track(
				`[probe] parent body AFTER subpage insert (before nav): ${JSON.stringify(parentAfterInsert)}`,
			);

			// === Click the page-ref → should open the sub-page B ===
			await pageRef.click();
			await notes.waitForTimeout(1500);
			await settle(notes);
			const refsOnSubPage = await notes.locator("a.notes__pageref").count();
			track(`[probe] page-refs visible after opening sub-page: ${refsOnSubPage}`);
			// The (new, empty) sub-page should NOT contain the parent's page-ref.
			const subPageOpened = refsOnSubPage === 0;
			track(`[probe] sub-page opened = ${subPageOpened}`);

			// === Click back → should return to parent A with the page-ref ===
			const backBtn = notes.locator('[data-testid="nav-back"]').first();
			await backBtn.waitFor({ state: "visible", timeout: 10_000 });
			await backBtn.click();
			await notes.waitForTimeout(2000);
			await settle(notes);

			const editableVisible = await editable.isVisible();
			const pageRefAfterBack = await notes.locator("a.notes__pageref").count();
			const parentBodyAfter = editableVisible ? await editable.innerText() : "(editor not visible)";
			track(`[probe] back: editable visible=${editableVisible} page-ref count=${pageRefAfterBack}`);
			track(`[probe] parent body after back: ${JSON.stringify(parentBodyAfter)}`);

			// Inspect on-disk .ydoc files to tell persistence-failure from
			// reload-failure. Parent id has an `ent_`/`n_` prefix; the store
			// shards by id prefix under data/docs/.
			const { readdirSync, statSync } = await import("node:fs");
			const docsDir = join(vaultPath, "data", "docs");
			const ydocFiles: string[] = [];
			try {
				for (const prefix of readdirSync(docsDir)) {
					for (const file of readdirSync(join(docsDir, prefix))) {
						ydocFiles.push(`${prefix}/${file} ${statSync(join(docsDir, prefix, file)).size}b`);
					}
				}
			} catch (e) {
				ydocFiles.push(`(read err: ${(e as Error).message})`);
			}
			track(`[probe] on-disk .ydoc files: ${JSON.stringify(ydocFiles)}`);
			track(`[probe] parentId=${parentId} subPageId=${subPageId}`);

			dump();

			expect(editorErrors, `editor must not throw; saw:\n${editorErrors.join("\n")}`).toHaveLength(0);
			expect(subPageOpened, "clicking the page-ref should open the (empty) sub-page").toBe(true);
			expect(editableVisible, "back should show the editor, not a blank/empty state").toBe(true);
			expect(pageRefAfterBack, "the parent's page-ref must survive the round-trip").toBeGreaterThan(0);
			expect(
				parentBodyAfter,
				`back should restore the parent's body, not show a blank page; got ${JSON.stringify(parentBodyAfter)}`,
			).toContain(PARENT_MARK);
		} catch (err) {
			dump();
			throw err;
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
