/**
 * KBN-P-canvas — real-Electron verification of the 12.4 canvas/grid rungs
 * (`docs/shell/61-keyboard-accessibility.md`):
 *
 *   - KBN-A-graph: the Pixi canvas container is a focusable
 *     `role="application"` surface; focusing it puts keyboard focus on a
 *     node and SPEAKS it through the attached live region; Tab moves the
 *     focus ring and re-announces.
 *   - KBN-A-whiteboard: nodes are focusable DOM — focusing one selects it
 *     and the board live region announces the selection.
 *   - KBN-S-dashboard: the icon grid is a spatial composite — arrows move
 *     the roving cursor between icons.
 *
 * The pure halves (focus ring math, selection summaries, spatialGridStep)
 * are unit-tested; this proves the live wiring in the production shell,
 * which jsdom cannot (no canvas layout, no real focus).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { launchAppPage } from "../../visual/lib/app-window";
import { waitForDashboard } from "../lib/keyboard-assertions";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";

async function openSeededDashboard(page: Page, userDataDir: string): Promise<void> {
	await page.evaluate(
		async ({ d }) => {
			const bs = (
				window as unknown as {
					brainstorm: {
						vaults: {
							create: (o: { name: string; path: string }) => Promise<unknown>;
							session: () => Promise<unknown>;
						};
					};
				}
			).brainstorm;
			await bs.vaults.create({ name: "kbn-canvas", path: `${d}/vault` });
			await bs.vaults.session();
		},
		{ d: userDataDir },
	);
	await page.reload();
	await waitForDashboard(page);
	await page.evaluate(async () => {
		const bs = (
			window as unknown as {
				brainstorm: {
					dev: { seedPrebuiltApps: () => Promise<unknown>; reseedVault: () => Promise<unknown> };
				};
			}
		).brainstorm;
		await bs.dev.seedPrebuiltApps();
		// Demo content so the Graph has a node population to lay out
		// (same precondition as graph-path.spec.ts).
		await bs.dev.reseedVault();
	});
}

test.describe("KBN-P-canvas — canvas + spatial-grid keyboard rungs", () => {
	test("graph canvas: focus ring + live-region announcements (KBN-A-graph)", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-canvas-graph-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				// `launchAppPage` resolves the real app-tab page (a window's first
				// `window` event is usually the shell tab strip, not the app).
				const graph = await launchAppPage(app, dashboard, "io.brainstorm.graph");
				const canvas = graph.locator("#canvas-container");
				await canvas.waitFor({ state: "visible", timeout: 30_000 });

				// The KBN-A-graph binding stamps the application role + makes the
				// draw surface a single Tab stop.
				await expect(canvas).toHaveAttribute("role", "application", { timeout: 15_000 });
				await expect(canvas).toHaveAttribute("tabindex", "0");

				// The focus ring is empty until nodes have layout positions —
				// focusing before that announces nothing (and doesn't retry when
				// data lands). Wait for laid-out nodes via the probe first.
				await graph.waitForFunction(
					() => {
						const probe = (window as unknown as { __graphProbe?: { nodes: () => unknown[] } })
							.__graphProbe;
						return !!probe && probe.nodes().length > 0;
					},
					null,
					{ timeout: 60_000 },
				);

				const live = graph.locator(".graph-canvas__live-region");
				await canvas.focus();
				await expect
					.poll(async () => ((await live.textContent()) ?? "").trim(), { timeout: 30_000 })
					.not.toBe("");
				const first = ((await live.textContent()) ?? "").trim();

				// Tab moves the ring to the next node and re-announces. The next
				// announcement must be non-empty AND different — a blur clears
				// the region to "", which must not satisfy this.
				await graph.keyboard.press("Tab");
				await expect
					.poll(
						async () => {
							const text = ((await live.textContent()) ?? "").trim();
							return text !== "" && text !== first;
						},
						{ timeout: 10_000 },
					)
					.toBe(true);

				console.log(`[kbn] graph canvas announce: "${first}" → Tab re-announced`);
			} finally {
				await app.close().catch(() => {});
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});

	test("whiteboard: focusing a node selects + announces it (KBN-A-whiteboard)", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-canvas-wb-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const wb = await launchAppPage(app, dashboard, "io.brainstorm.whiteboard");
				const canvas = wb.locator(".whiteboard__canvas-wrap").first();
				await canvas.waitFor({ state: "visible", timeout: 30_000 });

				// Create a sticky through the Add menu so the board has a node
				// (the React chrome's header menu button — labelled, no class).
				const add = wb.getByRole("button", { name: "Add to board" });
				await add.waitFor({ state: "visible", timeout: 15_000 });
				await add.click();
				const menu = wb.locator('.fm-menu[role="menu"]');
				await menu.waitFor({ state: "visible", timeout: 10_000 });
				await menu.getByText("Sticky note", { exact: false }).click();

				const node = wb.locator(".whiteboard__node").first();
				await node.waitFor({ state: "visible", timeout: 10_000 });
				// A fresh sticky opens selected + in text editing. Commit the
				// editor with the CommitEdit chord (Cmd/Ctrl+Enter), then clear
				// the creation selection with Escape (the ClearSelection chord —
				// live again now that a resolved editor strips its chrome) —
				// focus-announce only fires when focusing SELECTS (the
				// `shouldSelectOnFocus` guard), so the node must start
				// deselected and unfocused.
				await wb.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
				await wb
					.locator(".whiteboard__node-body--editing")
					.waitFor({ state: "detached", timeout: 5_000 });
				await wb.keyboard.press("Escape");
				await expect(wb.locator(".whiteboard__node--selected")).toHaveCount(0, {
					timeout: 5_000,
				});
				await wb.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
				const live = wb.locator(".whiteboard__live-region");
				const before = ((await live.textContent()) ?? "").trim();

				// Nodes are focusable DOM (tabIndex 0); focusing selects and the
				// board live region announces the selection summary.
				await node.focus();
				await expect
					.poll(
						async () => {
							const text = ((await live.textContent()) ?? "").trim();
							return text !== "" && text !== before;
						},
						{ timeout: 10_000 },
					)
					.toBe(true);

				console.log("[kbn] whiteboard node focus announced");
			} finally {
				await app.close().catch(() => {});
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});

	test("dashboard icon grid: spatial arrow navigation (KBN-S-dashboard)", async () => {
		test.setTimeout(180_000);
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-kbn-canvas-dash-"));
		try {
			const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
			try {
				const dashboard = await app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(dashboard);
				await openSeededDashboard(dashboard, userDataDir);

				const icons = dashboard.locator("[data-composite-index]");
				await icons.first().waitFor({ state: "visible", timeout: 15_000 });
				const count = await icons.count();
				expect(count, "dashboard renders composite icons").toBeGreaterThan(1);

				await icons.first().focus();
				const activeIndex = () =>
					dashboard.evaluate(() => document.activeElement?.getAttribute("data-composite-index") ?? null);
				const start = await activeIndex();
				expect(start, "an icon holds the roving cursor").not.toBeNull();

				// One spatial step: any arrow that has a neighbour moves the
				// cursor; try the four directions until one does (free placement
				// means no single direction is guaranteed from the first icon).
				let moved = false;
				for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
					await dashboard.keyboard.press(key);
					const now = await activeIndex();
					if (now !== null && now !== start) {
						moved = true;
						break;
					}
				}
				expect(moved, "an arrow key moves the spatial cursor to a neighbour icon").toBe(true);

				console.log("[kbn] dashboard spatial grid arrows hold");
			} finally {
				await app.close().catch(() => {});
			}
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
