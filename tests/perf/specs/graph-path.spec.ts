/**
 * Graph Path view (9.13): pick two nodes, highlight the shortest connection.
 *
 * Boots the real shell + seeded vault, opens Graph, toggles Path view via the
 * header button (asserting its pressed state), then drives the two endpoint
 * picks through the `__graphProbe` hook (clicking exact node pixels via
 * `pickNode` is too flaky). Picks the two ends of a real edge, so the shortest
 * path is the 2-node pair — asserts `pathNodeIds()` is exactly those two, then
 * toggles Path view off and asserts the highlight clears. The BFS itself is
 * unit-tested (shortest-path.test.ts); this proves the live wiring.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

const GRAPH_APP_ID = "io.brainstorm.graph";

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
				await bs.vaults.create({ name: "path-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("path harness: no active vault after setup");
			await bs.dev.seedDemoApps();
			await bs.dev.reseedVault();
		},
		{ userDataDir },
	);
}

test("graph Path view highlights the shortest path between two picked nodes", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-path-"));
	try {
		const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await dashboard.waitForLoadState("load", { timeout: 60_000 });
			await ensureVaultAndSeed(dashboard, userDataDir);

			const graphWindow = app.waitForEvent("window", { timeout: 30_000 });
			await dashboard.evaluate(
				(id) =>
					(
						window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
					).brainstorm.apps.launch(id),
				GRAPH_APP_ID,
			);
			const win = await graphWindow;
			const errors: string[] = [];
			win.on("pageerror", (e) => errors.push(e.message));
			await win.waitForLoadState("domcontentloaded", { timeout: 30_000 });

			await win.waitForFunction(
				() => {
					const probe = (window as unknown as { __graphProbe?: { edges: () => unknown[] } })
						.__graphProbe;
					return !!probe && probe.edges().length >= 1;
				},
				null,
				{ timeout: 30_000 },
			);

			// Toggle Path view on via the real header button.
			const pathBtn = win.locator("#header-btn-path");
			await pathBtn.click();
			await expect(pathBtn).toHaveAttribute("aria-pressed", "true");

			// Pick the two ends of a real edge → shortest path is that 2-node pair.
			const result = await win.evaluate(() => {
				const probe = (
					window as unknown as {
						__graphProbe: {
							edges: () => Array<{ source: string; target: string }>;
							pathPick: (id: string) => void;
							pathNodeIds: () => string[];
						};
					}
				).__graphProbe;
				const edge = probe.edges()[0];
				if (!edge) return null;
				probe.pathPick(edge.source);
				probe.pathPick(edge.target);
				return { edge, path: probe.pathNodeIds() };
			});
			expect(result).not.toBeNull();
			const { edge, path } = result as {
				edge: { source: string; target: string };
				path: string[];
			};
			expect(path).toContain(edge.source);
			expect(path).toContain(edge.target);
			expect(path.length).toBe(2);

			await win.screenshot({ path: join(userDataDir, "01-path.png") }).catch(() => {});

			// Toggle Path view off → highlight clears.
			await pathBtn.click();
			await expect(pathBtn).toHaveAttribute("aria-pressed", "false");
			const cleared = await win.evaluate(
				() =>
					(
						window as unknown as { __graphProbe: { pathNodeIds: () => string[] } }
					).__graphProbe.pathNodeIds().length,
			);
			expect(cleared).toBe(0);

			expect(errors, `unexpected errors:\n${errors.join("\n")}`).toEqual([]);
		} finally {
			await app.close().catch(() => {});
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
