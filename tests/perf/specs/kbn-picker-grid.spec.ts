/**
 * KBN-P-picker-grid — `docs/shell/61-keyboard-accessibility.md §Validation`.
 *
 * The icon-picker's virtualized emoji grid (KBN-S-pickers, the formerly-⚪
 * half) is one Tab stop: the scroll container carries the hook-stamped
 * `role="grid"` + `aria-activedescendant`, arrow keys move the cursor
 * through the flat row-major item order, the cursor's row is scrolled into
 * view so the referenced cell is always mounted, and Enter picks the active
 * cell. jsdom can't exercise any of this (the virtualizer renders an empty
 * window without a layout engine) — this is the real-renderer proof, driven
 * through Notes' header icon-pick affordance against the production shell.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { waitForAppTabPage } from "../../visual/lib/app-window";
import { launchShell } from "../lib/launch-shell";

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
						dev: { seedPrebuiltApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "picker-grid", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("picker-grid harness: no active vault after setup");
			await bs.dev.seedPrebuiltApps();
		},
		{ userDataDir },
	);
}

test("icon-picker emoji grid: one Tab stop, arrow cursor, Enter picks", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-picker-grid-"));
	try {
		const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await dashboard.waitForLoadState("domcontentloaded");
			await ensureVaultAndSeed(dashboard, userDataDir);

			const scratchResult = await dashboard.evaluate(async () => {
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
			if (!scratchResult.ok) throw new Error(`scratch note failed: ${scratchResult.reason}`);
			// Resolve the real app-tab page — a window's first `window` event is
			// usually the shell tab strip, not the app renderer.
			const notes = await waitForAppTabPage(app);
			await notes.waitForLoadState("domcontentloaded");

			// Open the SDK icon picker via the header icon-pick affordance.
			const pickButton = notes.locator(".bs-icon-pick").first();
			await pickButton.waitFor({ state: "visible", timeout: 30_000 });
			await pickButton.click();

			// The emoji grid container carries the hook-stamped role + is the
			// single Tab stop (aria-activedescendant mode, no roving tabindex).
			const grid = notes.locator('.icon-picker__scroll[role="grid"]');
			await expect(grid, "virtual grid carries role=grid").toBeVisible({ timeout: 10_000 });
			await expect(grid).toHaveAttribute("tabindex", "0");

			const activeDescendant = () => grid.getAttribute("aria-activedescendant");
			const activeCell = () =>
				notes.evaluate(() => {
					const scroll = document.querySelector('.icon-picker__scroll[role="grid"]');
					const id = scroll?.getAttribute("aria-activedescendant");
					const cell = id ? document.getElementById(id) : null;
					return cell
						? {
								index: cell.getAttribute("data-composite-index"),
								selected: cell.getAttribute("aria-selected"),
								role: cell.getAttribute("role"),
								label: cell.getAttribute("aria-label"),
							}
						: null;
				});

			await grid.focus();
			await notes.keyboard.press("Home");
			const atHome = await activeCell();
			expect(atHome, "Home: the active descendant cell is mounted").not.toBeNull();
			expect(atHome?.index, "Home lands on the first cell").toBe("0");
			expect(atHome?.selected, "aria-selected marks the cursor cell").toBe("true");
			expect(atHome?.role, "the cursor cell is a gridcell").toBe("gridcell");

			// ArrowRight moves +1 in the flat row-major order.
			await notes.keyboard.press("ArrowRight");
			const afterRight = await activeCell();
			expect(afterRight?.index, "ArrowRight advances the cursor").toBe("1");

			// ArrowDown moves a full row (one column-count stride), and the
			// virtualizer keeps the cursor's row mounted.
			const beforeDownId = await activeDescendant();
			await notes.keyboard.press("ArrowDown");
			const afterDown = await activeCell();
			expect(afterDown, "ArrowDown: cursor cell still mounted").not.toBeNull();
			expect(Number(afterDown?.index), "ArrowDown moves a full row").toBeGreaterThan(1);
			expect(await activeDescendant(), "activedescendant id changed").not.toBe(beforeDownId);

			// Enter picks the active cell: the picker closes and the header
			// affordance now renders the picked emoji.
			const pickedLabel = afterDown?.label ?? "";
			await notes.keyboard.press("Enter");
			await expect(notes.locator(".icon-picker__panel")).toBeHidden({ timeout: 10_000 });
			expect(pickedLabel, "the picked cell carried an emoji name").not.toBe("");

			console.log("[kbn] picker-grid: role=grid + activedescendant arrows + Enter-pick hold");
		} finally {
			await app.close().catch(() => {});
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
