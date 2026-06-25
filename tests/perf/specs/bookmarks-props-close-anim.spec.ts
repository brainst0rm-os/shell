/**
 * Behavioral guard: the Bookmarks properties panel must SLIDE OUT on close
 * (a `transform` transition on `.bs-props`), not snap shut. Even though the
 * props toggle routes through the full `render()` (which `replaceChildren`s
 * the detail island), React commits the `bs-props--open` class change AFTER
 * the island re-attaches, so the slide still runs — this spec pins that.
 *
 * Drives the real shell: open a bookmark, close the panel via the header
 * toggle and via the in-panel close button, and assert a `transform`
 * transition fires both times with the panel staying mounted.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

const BOOKMARKS_APP_ID = "io.brainstorm.bookmarks";

async function ensureVaultAndSeed(dashboard: Page, userDataDir: string): Promise<void> {
	await dashboard.evaluate(
		async ({ userDataDir }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							list: () => Promise<unknown[]>;
							create: (opts: { name: string; path: string }) => Promise<unknown>;
							activate: (id: string) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
						dev: { seedDemoApps: () => Promise<unknown>; reseedVault: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "bm-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("bookmarks harness: no active vault");
			await bs.dev.seedDemoApps();
			await bs.dev.reseedVault();
		},
		{ userDataDir },
	);
}

test("bookmarks properties panel slides out on close", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-bm-"));
	const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
	try {
		const dashboard = await app.firstWindow({ timeout: 60_000 });
		await dashboard.waitForLoadState("load", { timeout: 60_000 });
		await ensureVaultAndSeed(dashboard, userDataDir);

		const bmWindow = app.waitForEvent("window", { timeout: 30_000 });
		await dashboard.evaluate(
			(id) =>
				(
					window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
				).brainstorm.apps.launch(id),
			BOOKMARKS_APP_ID,
		);
		const win = await bmWindow;
		win.on("pageerror", (e) => console.log("[bm-win:pageerror]", e.message));
		await win.waitForLoadState("domcontentloaded", { timeout: 30_000 });

		// Open a bookmark detail (first card), then make sure the panel is open.
		await win.waitForSelector(".bookmarks__card", { timeout: 30_000 });
		await win.evaluate(() => {
			document.querySelector<HTMLElement>(".bookmarks__card")?.click();
		});
		await win.waitForSelector(".bs-props", { timeout: 15_000 });
		await win.evaluate(() => {
			const aside = document.querySelector(".bs-props");
			if (aside && !aside.classList.contains("bs-props--open")) {
				// open it via the in-panel toggle is N/A when closed; use header
				document.querySelector<HTMLButtonElement>('.bs-panel-toggle[aria-pressed="false"]')?.click();
			}
		});
		await win.waitForTimeout(700);

		// Close via the HEADER toggle ("Hide properties") — the user's actual
		// action — capturing transition events on the panel. Then re-open and
		// close a SECOND time (catches a first-time-only animation).
		const closeOnce = async (page: typeof win, viaHeader: boolean) =>
			page.evaluate(async (viaHeader) => {
				const aside = document.querySelector<HTMLElement>(".bs-props");
				if (!aside) return { error: "no .bs-props" };
				const wasOpen = aside.classList.contains("bs-props--open");
				const events: string[] = [];
				const onStart = (e: Event) => events.push(`start:${(e as TransitionEvent).propertyName}`);
				aside.addEventListener("transitionstart", onStart);
				const before = getComputedStyle(aside).transform;
				if (viaHeader) {
					document.querySelector<HTMLButtonElement>('button[aria-label="Hide properties"]')?.click();
				} else {
					document.querySelector<HTMLButtonElement>(".bs-props__close")?.click();
				}
				await new Promise((r) => setTimeout(r, 90));
				const mid = getComputedStyle(aside).transform;
				const stillMounted = document.body.contains(aside);
				await new Promise((r) => setTimeout(r, 400));
				aside.removeEventListener("transitionstart", onStart);
				return { wasOpen, events, before, mid, stillMounted };
			}, viaHeader);

		const reopen = async (page: typeof win) => {
			await page.evaluate(() => {
				document.querySelector<HTMLButtonElement>('button[aria-label="Show properties"]')?.click();
			});
			await page.waitForTimeout(600);
		};

		const first = await closeOnce(win, true);
		console.log("[BM-CLOSE-1 header]", JSON.stringify(first));
		await reopen(win);
		const second = await closeOnce(win, false);
		console.log("[BM-CLOSE-2 in-panel]", JSON.stringify(second));

		for (const r of [first, second]) {
			expect(r.error).toBeUndefined();
			expect(r.wasOpen).toBe(true);
			expect(r.stillMounted).toBe(true);
			expect(r.events).toContain("start:transform");
			expect(r.mid).not.toBe(r.before);
		}
	} finally {
		await app.close();
	}
});
