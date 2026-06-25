/**
 * Regression: the Graph re-tessellated its entire edge `Graphics` every
 * frame, even on a pure zoom/pan where the world-space geometry is
 * unchanged (the camera transform on `worldContainer` already moves it).
 * On a weak GPU that per-frame buffer rebuild + re-upload is the dominant
 * cost of zoom/pan lag.
 *
 * The fix gates `drawEdges` on a `geometryDirty` flag — set only when node
 * positions move, the scene/colours change, the focus dim animates, or the
 * arrowhead LOD flips. A pure zoom (cursor over empty canvas, sim settled)
 * must NOT rebuild the edge buffer.
 *
 * Test: open the seeded Graph, let it settle, then drive ~30 wheel-zoom
 * ticks with the cursor over empty canvas and assert the renderer's
 * `edgeRebuilds` counter (stamped on the canvas dataset) barely moves —
 * vs. one rebuild per painted frame before the fix.
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
				await bs.vaults.create({ name: "zoom-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("zoom harness: no active vault");
			await bs.dev.seedDemoApps();
			await bs.dev.reseedVault();
		},
		{ userDataDir },
	);
}

test("graph zoom does not rebuild the edge buffer per frame", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-zoom-"));
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
			win.on("pageerror", (e) => console.log("[graph-win:pageerror]", e.message));
			await win.waitForLoadState("domcontentloaded", { timeout: 30_000 });

			await win.waitForFunction(
				() => {
					const probe = (window as unknown as { __graphProbe?: { nodes: () => unknown[] } })
						.__graphProbe;
					return probe ? probe.nodes().length >= 50 : false;
				},
				null,
				{ timeout: 30_000 },
			);
			// Let the auto-fit + initial spread settle so the sim is no longer
			// warm (a warm sim legitimately rebuilds edges every frame).
			await win.waitForTimeout(5000);

			const nodeCount = await win.evaluate(
				() =>
					(
						window as unknown as { __graphProbe: { nodes: () => unknown[]; edges: () => unknown[] } }
					).__graphProbe.nodes().length,
			);
			console.log(`[zoom] nodes=${nodeCount}`);

			const canvas = await win.evaluateHandle(() =>
				(
					window as unknown as { __graphProbe: { canvas: () => HTMLCanvasElement } }
				).__graphProbe.canvas(),
			);
			const el = canvas.asElement();
			const box = el ? await el.boundingBox() : null;
			expect(box, "graph canvas has no bounding box").not.toBeNull();
			if (!box) return;
			// Aim the cursor at a top corner — empty canvas, so the wheel zoom
			// doesn't hover a node (hover would legitimately dirty the geometry
			// via focus dimming).
			const cx = box.x + 24;
			const cy = box.y + 24;

			const readRebuilds = () =>
				win.evaluate(() => {
					const c = (
						window as unknown as { __graphProbe: { canvas: () => HTMLCanvasElement } }
					).__graphProbe.canvas();
					return Number(c?.dataset.edgeRebuilds ?? "0");
				});

			await win.mouse.move(cx, cy);
			await win.waitForTimeout(300);
			const before = await readRebuilds();

			let frames = 0;
			for (let i = 0; i < 30; i++) {
				await win.mouse.wheel(0, -40);
				await win.waitForTimeout(16);
				frames += 1;
			}
			await win.waitForTimeout(200);
			const after = await readRebuilds();
			const delta = after - before;
			console.log(
				`[zoom] edgeRebuilds before=${before} after=${after} delta=${delta} (${frames} wheel ticks)`,
			);

			// Pre-fix this equalled one rebuild per painted frame (≈90+ over the
			// zoom). Post-fix only the arrowhead-LOD crossing (k passing 0.5) can
			// dirty geometry, plus a stray settle frame — a handful at most.
			expect(
				delta,
				`edge buffer rebuilt ${delta}× during a pure zoom — geometryDirty gate regressed`,
			).toBeLessThanOrEqual(5);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
