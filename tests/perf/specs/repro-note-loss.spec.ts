/**
 * Repro probe — user reported that creating a note, typing, closing, and
 * reopening produces an empty editor while the .ydoc on disk still has the
 * typed content. Drive the full sequence through Playwright; capture every
 * renderer console message + main-process log line so we can pinpoint which
 * IPC call falls over (suspected: the Stage 10.1 DEK transaction silently
 * leaving the entity row missing from `entities.db`).
 *
 * NOT a perf spec — lives alongside them only because the existing
 * `launch-shell.ts` harness is the cleanest way to drive a built Electron
 * shell from Node. Skip the existing perf-budget asserts; we're looking for
 * functional correctness.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

function wireConsole(label: string, page: Page, sink: string[]): void {
	page.on("console", (msg: ConsoleMessage) => {
		const text = msg.text();
		sink.push(`[${label}/${msg.type()}] ${text}`);
	});
	page.on("pageerror", (err) => {
		sink.push(`[${label}/pageerror] ${err.message}`);
	});
}

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

async function openNotesApp(
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

test("repro — type a note, close, reopen, expect content (NOT empty)", async () => {
	test.setTimeout(300_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-repro-loss-"));
	const vaultPath = join(userDataDir, "vault");
	const consoleLog: string[] = [];
	const dumpAndRethrow = (origErr: unknown): never => {
		console.log("\n========== REPRO LOG (chronological) ==========");
		for (const line of consoleLog) console.log(line);
		console.log("================================================\n");
		throw origErr;
	};
	try {
		const launched = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			// Capture EVERY window's console, identified by its URL fragment.
			// Same-app reopen reuses the renderer process; using a per-Page
			// `on("console")` from outside that capture missed logs the second
			// time around.
			let windowCount = 0;
			launched.app.on("window", (page) => {
				windowCount += 1;
				const tag = `win${windowCount}`;
				const url = page.url();
				consoleLog.push(`[probe] new window #${windowCount} url=${url}`);
				page.on("console", (msg) => {
					consoleLog.push(`[${tag}/${msg.type()}] ${msg.text()}`);
				});
				page.on("pageerror", (err) => {
					consoleLog.push(`[${tag}/pageerror] ${err.message}`);
				});
			});
			const dashboard = await launched.app.firstWindow({ timeout: 60_000 });
			// firstWindow doesn't fire the "window" event, so wire console
			// here separately for the dashboard.
			dashboard.on("console", (msg) => {
				consoleLog.push(`[dashboard/${msg.type()}] ${msg.text()}`);
			});
			dashboard.on("pageerror", (err) => {
				consoleLog.push(`[dashboard/pageerror] ${err.message}`);
			});
			launched.app.on("console", (msg) => {
				consoleLog.push(`[main/${msg.type()}] ${msg.text()}`);
			});
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultCreated(dashboard, vaultPath);

			// === First open of Notes: create note + type ===
			const notesA = await openNotesApp(dashboard, launched.app);

			// Click "+ new note" header button. Notes uses an aria-label that
			// matches the t("notes.header.newNote") string — "New note".
			const newNoteBtn = notesA.getByRole("button", { name: "New note" });
			await newNoteBtn.waitFor({ state: "visible", timeout: 30_000 });
			await newNoteBtn.click();

			// Wait for the editor's contenteditable to appear.
			const editable = notesA.locator('[contenteditable="true"]').first();
			await editable.waitFor({ state: "visible", timeout: 30_000 });
			await editable.click();

			// Type a paragraph of content the editor MUST persist.
			await notesA.keyboard.type("hello-from-playwright-this-must-survive", { delay: 20 });

			// Allow the autosave debounce (400 ms) + a margin to flush.
			await notesA.waitForTimeout(1500);

			// Grab the rendered text so we know what we just put in.
			const beforeText = await editable.innerText();
			consoleLog.push(`[probe] before-close editable text: ${JSON.stringify(beforeText)}`);

			// Close the Notes window — same gesture the user described.
			await notesA.close();

			// === Reopen Notes ===
			consoleLog.push(`[probe] about to reopen Notes (current window count=${windowCount})`);
			const notesB = await openNotesApp(dashboard, launched.app);
			consoleLog.push(`[probe] reopened, total windows=${windowCount}, notesB url=${notesB.url()}`);

			// Click the note row button — the section <li> also matches
			// .notes__sidebar-row but isn't interactive, so target the
			// inner button explicitly.
			const noteBtn = notesB.locator("button.notes__sidebar-item").first();
			await noteBtn.waitFor({ state: "visible", timeout: 30_000 });
			await noteBtn.click();

			// Wait for the editor surface.
			const editableB = notesB.locator('[contenteditable="true"]').first();
			await editableB.waitFor({ state: "visible", timeout: 30_000 });
			// Give the Y.Doc loadDoc round-trip + bind time.
			await notesB.waitForTimeout(2000);

			const afterText = await editableB.innerText();
			const afterHtml = await editableB.evaluate((el) => (el as HTMLElement).outerHTML.slice(0, 800));
			const docInfo = await notesB.evaluate(() => {
				const w = window as unknown as {
					__lexicalEditor?: unknown;
				};
				const eds: string[] = [];
				for (const ce of Array.from(document.querySelectorAll('[contenteditable="true"]'))) {
					eds.push((ce as HTMLElement).innerText);
				}
				return { editableCount: eds.length, editableTexts: eds.map((s) => s.slice(0, 80)) };
			});
			consoleLog.push(`[probe] after-reopen editable text: ${JSON.stringify(afterText)}`);
			consoleLog.push(`[probe] after-reopen editable HTML: ${afterHtml}`);
			consoleLog.push(`[probe] after-reopen doc-info: ${JSON.stringify(docInfo)}`);

			// Inspect on-disk state for diagnostics.
			const docsDir = join(vaultPath, "data", "docs");
			let ydocList: string[] = [];
			try {
				for (const prefix of readdirSync(docsDir)) {
					for (const file of readdirSync(join(docsDir, prefix))) {
						const s = statSync(join(docsDir, prefix, file));
						ydocList.push(`${prefix}/${file} ${s.size}b`);
					}
				}
			} catch (e) {
				ydocList = [`(read err: ${(e as Error).message})`];
			}
			consoleLog.push(`[probe] on-disk .ydoc files: ${JSON.stringify(ydocList)}`);

			const auditPath = join(vaultPath, "logs", "audit.log");
			let auditTail: string;
			try {
				const lines = readFileSync(auditPath, "utf8").trim().split("\n");
				auditTail = lines.slice(-20).join("\n");
			} catch (e) {
				auditTail = `(audit log read err: ${(e as Error).message})`;
			}
			consoleLog.push(`[probe] audit log (last 20):\n${auditTail}`);

			// Print everything we collected before any assertion fails so the
			// diagnostic is in the test output regardless of outcome.
			console.log("\n========== REPRO LOG (chronological) ==========");
			for (const line of consoleLog) console.log(line);
			console.log("================================================\n");

			expect(
				afterText,
				`reopened editor should contain typed content; before=${JSON.stringify(beforeText)} after=${JSON.stringify(afterText)}`,
			).toContain("hello-from-playwright");
		} catch (err) {
			dumpAndRethrow(err);
		} finally {
			await launched.app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
