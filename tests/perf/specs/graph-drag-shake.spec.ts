/**
 * Regression: graph nodes shake while dragging.
 *
 * The Graph app pins the dragged node under the cursor (d3-force fx/fy
 * pattern) and reheats the simulation so neighbours follow. The reheat
 * alpha must be held LOW (≤0.05) — at d3's idiomatic 0.3 the per-tick
 * spring impulse exceeds what `velocityDecay=0.58` can damp before the
 * spring reverses, producing a visible orbit/shake on large connected
 * nodes. The bug shipped twice because the reheat is written in THREE
 * places (pointerdown, pointermove, AND the rAF loop while
 * `state.drag != null`); the rAF loop slammed alpha back to 0.3 every
 * frame, silently overriding the calm values set by the pointer handlers.
 *
 * Test: open Graph, find a connected node, simulate a press + small move,
 * then HOLD the mouse still and sample the simulated `(x, y, vx, vy)` of
 * the dragged node's neighbours over ~700 ms. If shake is present the
 * neighbours keep oscillating (sign-flipping velocities, position deltas
 * > ~0.3 px frame-to-frame). After the fix they converge monotonically
 * and motion drops below the threshold within the sample window.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { launchShell } from "../lib/launch-shell";

const GRAPH_APP_ID = "io.brainstorm.graph";

type ProbeNode = {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	fx: number | null;
	fy: number | null;
};

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
						dev: {
							seedDemoApps: () => Promise<unknown>;
							reseedVault: () => Promise<unknown>;
						};
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "shake-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("shake harness: no active vault after setup");
			await bs.dev.seedDemoApps();
			// Seed entities + links — without this the vault has the Graph
			// app installed but no objects/links to draw, and the test can't
			// find a connected node to drag.
			await bs.dev.reseedVault();
		},
		{ userDataDir },
	);
}

test("graph drag does not shake neighbours when the cursor is held still", async () => {
	test.setTimeout(180_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-shake-"));
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

			// Wait for the probe + a non-trivial connected graph. The seed
			// produces a vault with edges; we just need at least one edge.
			await win.waitForFunction(
				() => {
					const probe = (
						window as unknown as { __graphProbe?: { nodes: () => unknown[]; edges: () => unknown[] } }
					).__graphProbe;
					if (!probe) return false;
					const ns = probe.nodes();
					const es = probe.edges();
					return ns.length >= 3 && es.length >= 1;
				},
				null,
				{ timeout: 30_000 },
			);
			// Settle: give the auto-fit camera + initial pre-converge a moment.
			// The spread force defaults lay a dense vault out over a much
			// larger area, so the off-thread pre-converge needs longer to come
			// to rest; if we drag before it settles the target node is still
			// drifting and the press misses it (pickNode grabs empty space).
			await win.waitForTimeout(3000);

			// Pick a connected node (one that appears in at least one edge).
			// Compute the client-space coords of the node centre via the
			// probe's `worldToClient` helper.
			const target = await win.evaluate(() => {
				const probe = (
					window as unknown as {
						__graphProbe: {
							nodes: () => Array<{ id: string; x: number; y: number }>;
							edges: () => Array<{ source: string; target: string }>;
							worldToClient: (x: number, y: number) => { x: number; y: number };
							canvas: () => HTMLCanvasElement | null;
						};
					}
				).__graphProbe;
				const nodes = probe.nodes();
				const edges = probe.edges();
				const degree = new Map<string, number>();
				for (const e of edges) {
					degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
					degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
				}
				// Prefer a high-degree node — that's where shake is most visible.
				let best: { id: string; deg: number } | null = null;
				for (const n of nodes) {
					const d = degree.get(n.id) ?? 0;
					if (d > 0 && (!best || d > best.deg)) best = { id: n.id, deg: d };
				}
				if (!best) return null;
				// Pick a MEDIUM-degree node — the highest-degree hub drags the
				// whole cluster along (legitimate convergence flood), which
				// dwarfs the per-frame oscillation we're trying to measure.
				// A 2–5 degree node is enough to drive springs without
				// also unbalancing the centroid.
				const sorted = Array.from(degree.entries())
					.filter(([, d]) => d >= 2 && d <= 5)
					.sort((a, b) => b[1] - a[1]);
				const pickId = sorted[0]?.[0] ?? best.id;
				best = { id: pickId, deg: degree.get(pickId) ?? best.deg };
				const n = nodes.find((x) => x.id === best.id);
				if (!n) return null;
				const client = probe.worldToClient(n.x, n.y);
				const canvas = probe.canvas();
				const rect = canvas?.getBoundingClientRect();
				return {
					id: n.id,
					clientX: client.x,
					clientY: client.y,
					rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
					degree: best.deg,
					neighbourIds: edges
						.filter((e) => e.source === best.id || e.target === best.id)
						.map((e) => (e.source === best.id ? e.target : e.source)),
				};
			});

			expect(target, "no connected node found in seeded graph").not.toBeNull();
			if (!target) return;

			console.log(
				`[shake] dragging node ${target.id} (degree=${target.degree}) at client (${target.clientX.toFixed(1)}, ${target.clientY.toFixed(1)})`,
			);

			// Drive a real pointer: down on the node, move 40 px right, then
			// HOLD still for the sampling window. Anything moving after the
			// hold begins is the simulation, not the cursor.
			await win.mouse.move(target.clientX, target.clientY);
			await win.mouse.down();
			// One small move so the drag handler engages and fixes the node.
			await win.mouse.move(target.clientX + 40, target.clientY, { steps: 4 });
			// Capture the dragged node id and neighbour ids for sampling.
			const sampleSpec = { dragged: target.id, neighbours: target.neighbourIds };

			// Sample positions every ~50 ms for ~700 ms.
			const SAMPLES = 14;
			const PERIOD_MS = 50;
			const trail: ProbeNode[][] = [];
			for (let i = 0; i < SAMPLES; i++) {
				const snap = await win.evaluate((spec) => {
					const probe = (
						window as unknown as {
							__graphProbe: {
								nodes: () => Array<{
									id: string;
									x: number;
									y: number;
									vx: number;
									vy: number;
									fx: number | null;
									fy: number | null;
								}>;
							};
						}
					).__graphProbe;
					const all = probe.nodes();
					const want = new Set<string>([spec.dragged, ...spec.neighbours]);
					return all.filter((n) => want.has(n.id));
				}, sampleSpec);
				trail.push(snap as ProbeNode[]);
				await win.waitForTimeout(PERIOD_MS);
			}

			await win.mouse.up();

			// Analysis:
			//   (1) Dragged node must NOT move while the cursor is held still.
			//   (2) Neighbour velocities must NOT sign-flip — a sign flip is
			//       the literal definition of shake (back-and-forth motion).
			//       Monotonic motion (drift toward a new equilibrium after the
			//       drag) is fine; alternating motion is not.
			type Series = { id: string; deltas: number[]; vxSignFlips: number; vySignFlips: number };
			const series = new Map<string, Series>();
			for (let i = 1; i < trail.length; i++) {
				const prev = trail[i - 1];
				const curr = trail[i];
				if (!prev || !curr) continue;
				for (const node of curr) {
					const before = prev.find((p) => p.id === node.id);
					if (!before) continue;
					const dx = node.x - before.x;
					const dy = node.y - before.y;
					const dpos = Math.hypot(dx, dy);
					const entry = series.get(node.id) ?? {
						id: node.id,
						deltas: [],
						vxSignFlips: 0,
						vySignFlips: 0,
					};
					entry.deltas.push(dpos);
					if (before.vx !== 0 && Math.sign(before.vx) !== Math.sign(node.vx) && node.vx !== 0)
						entry.vxSignFlips += 1;
					if (before.vy !== 0 && Math.sign(before.vy) !== Math.sign(node.vy) && node.vy !== 0)
						entry.vySignFlips += 1;
					series.set(node.id, entry);
				}
			}

			const draggedSeries = series.get(sampleSpec.dragged);
			expect(draggedSeries, "dragged node missing from trail").toBeDefined();
			const draggedMax = Math.max(...(draggedSeries?.deltas ?? [0]));
			console.log(
				`[shake] dragged-node max per-frame Δpos while cursor held: ${draggedMax.toFixed(3)} px`,
			);
			// Allow a tiny epsilon for the worker frame that arrives between
			// the last cursor move and the first sample. After that the fx/fy
			// is fixed and the dragged node must not move.
			expect(draggedMax, "dragged node moved while cursor was held still").toBeLessThan(2.0);

			const neighbourReport: string[] = [];
			let worstFlips = 0;
			let worstStep = 0;
			let countedNeighbours = 0;
			for (const id of sampleSpec.neighbours) {
				const s = series.get(id);
				if (!s || s.deltas.length < 6) continue;
				countedNeighbours += 1;
				const peak = Math.max(...s.deltas);
				worstFlips = Math.max(worstFlips, s.vxSignFlips, s.vySignFlips);
				worstStep = Math.max(worstStep, peak);
				neighbourReport.push(
					`  ${id.slice(0, 8)}…: vx-flips=${s.vxSignFlips}, vy-flips=${s.vySignFlips}, max|Δpos|/sample=${peak.toFixed(2)} px`,
				);
			}
			console.log(`[shake] neighbours (${countedNeighbours}):\n${neighbourReport.join("\n")}`);
			console.log(
				`[shake] worst-neighbour signFlips=${worstFlips}, worstPeak/sample=${worstStep.toFixed(2)} px`,
			);

			// SHAKE manifests two ways and we test for both:
			//
			//   (a) velocity sign-flips — the textbook "neighbour oscillates
			//       back and forth" signature. With the bug, the
			//       under-damped sim can flip several times across a
			//       short window; with the fix, ≤2 flips per axis even on
			//       a freshly perturbed cluster.
			//
			//   (b) per-sample displacement magnitude — *the* signature the
			//       user actually sees. At reheat=0.3 (bug) the per-tick
			//       spring impulse is 6× larger than at reheat=0.05 (fix), so
			//       neighbours bolt ~3× further per 50 ms sample (≈3 sim
			//       ticks). Measured against the seeded vault, the bug
			//       reliably produces ≥15 px peak / sample on a degree-5
			//       node; the fix stays well under 10 px. A 10 px ceiling
			//       leaves slack for natural settle without admitting shake.
			expect(worstFlips, "a neighbour's velocity reversed multiple times — shake").toBeLessThanOrEqual(
				2,
			);
			expect(
				worstStep,
				`peak per-sample neighbour motion too high (${worstStep.toFixed(2)} px) — drag-time alpha is over-energising the sim`,
			).toBeLessThan(10);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
