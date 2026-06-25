/**
 * 13.4 — idle footprint (CPU + RAM) and per-app renderer RAM.
 *
 * Real-Electron complement to the headless stress suite
 * (`packages/shell/src/main/integration/stress.test.ts`). These three budgets
 * are inherently process-level and can only be measured against a running
 * shell, so they live as a Playwright/Electron spec, NOT a vitest test:
 *
 *   - **Idle CPU** (`<0.5%`) — with no app window open, the main +
 *     dashboard-renderer processes should be near-quiescent.
 *   - **Idle RAM** (`<250MB`) — summed working set of the main +
 *     dashboard-renderer processes, no apps.
 *   - **Per-app renderer RAM** (`<80MB`) — the working set of one freshly
 *     launched first-party app's renderer process, isolated from the shell.
 *
 * Measurement source is Electron's `app.getAppMetrics()` (evaluated in the
 * main process), which reports `cpu.percentCPUUsage` (as a percentage of one
 * core) and `memory.workingSetSize` (KiB) per child process, tagged by
 * `type` (`Browser` = main, `Tab`/`renderer` = a renderer, `utility` = a
 * worker). The dashboard renderer is the first renderer; an app renderer is
 * the one that appears after `apps.launch`.
 *
 * Budgets: `idleCpu`, `idleRam`, `perAppRendererRam`
 * (`docs/shell/12-shell-architecture.md §Performance budgets`).
 *
 * NOTE FOR THE INTEGRATOR: this spec needs the production shell build
 * (`bun run perf:build`) and — in a git worktree — the documented native-ABI
 * graft (the Electron-built better-sqlite3 `.node` copied into the worktree's
 * node_modules, per the worktree-native-ABI memory). Without those it throws a
 * clear "Shell build not found" / native-load error rather than a false pass.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, type Page, expect, test } from "@playwright/test";
import { BUDGETS } from "../lib/budgets";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";
import { appendResult, makeResult } from "../lib/results";
import type { SampleStats } from "../lib/stats";
import { summarize } from "../lib/stats";

/** Notes is the most pessimistic first-party renderer (Lexical + Yjs), so its
 *  baseline working set is an upper-bound regression baseline. */
const APP_ID = "io.brainstorm.notes";

const CPU_SAMPLES = Number.parseInt(process.env.BS_PERF_IDLE_CPU_SAMPLES ?? "20", 10);
const CPU_SAMPLE_INTERVAL_MS = Number.parseInt(
	process.env.BS_PERF_IDLE_CPU_INTERVAL_MS ?? "250",
	10,
);
/** Quiet-window settle before sampling — the shell does real work for a
 *  moment after first paint (wiring IPC, hydrating the dashboard Y.Doc).
 *  Measure the steady state, not the boot transient. */
const SETTLE_MS = Number.parseInt(process.env.BS_PERF_IDLE_SETTLE_MS ?? "3000", 10);

type ProcMetric = {
	type: string;
	pid: number;
	percentCPUUsage: number;
	workingSetKib: number;
};

/** Read `app.getAppMetrics()` in the main process, flattened to a small
 *  serialisable shape (Playwright marshals the return value over CDP). */
async function readAppMetrics(app: ElectronApplication): Promise<ProcMetric[]> {
	return app.evaluate(({ app }) =>
		app.getAppMetrics().map((m) => ({
			type: m.type,
			pid: m.pid,
			percentCPUUsage: m.cpu?.percentCPUUsage ?? 0,
			workingSetKib: m.memory?.workingSetSize ?? 0,
		})),
	);
}

function isMain(m: ProcMetric): boolean {
	return m.type === "Browser";
}
function isRenderer(m: ProcMetric): boolean {
	return m.type === "Tab" || m.type === "renderer";
}

function sumWorkingSetMb(metrics: ProcMetric[], pick: (m: ProcMetric) => boolean): number {
	const kib = metrics.filter(pick).reduce((acc, m) => acc + m.workingSetKib, 0);
	return kib / 1024; // KiB → MiB
}

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
						dev: { seedDemoApps: () => Promise<unknown> };
					};
				}
			).brainstorm;
			const list = (await bs.vaults.list()) as Array<{ id: string }>;
			let session = await bs.vaults.session();
			if (list.length === 0) {
				await bs.vaults.create({ name: "perf-fixture", path: `${userDataDir}/vault` });
				session = await bs.vaults.session();
			} else if (!session && list[0]) {
				await bs.vaults.activate(list[0].id);
				session = await bs.vaults.session();
			}
			if (!session) throw new Error("perf harness: no active vault after setup");
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

test("idle footprint — CPU + RAM (no apps) and per-app renderer RAM", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-idle-"));
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			// Let the shell reach steady state before sampling.
			await dashboard.waitForTimeout(SETTLE_MS);

			// ── Idle CPU: sample the summed main + dashboard CPU% over a quiet
			//    window. getAppMetrics' percentCPUUsage is the usage since the
			//    previous call, so consecutive samples each cover one interval. ──
			await readAppMetrics(app); // prime the delta baseline
			const cpuSamples: number[] = [];
			for (let i = 0; i < CPU_SAMPLES; i++) {
				await dashboard.waitForTimeout(CPU_SAMPLE_INTERVAL_MS);
				const metrics = await readAppMetrics(app);
				const idleCpu = metrics
					.filter((m) => isMain(m) || isRenderer(m))
					.reduce((acc, m) => acc + m.percentCPUUsage, 0);
				cpuSamples.push(idleCpu);
			}
			const cpuStats = summarize(cpuSamples);

			// ── Idle RAM: main + dashboard-renderer working set, no apps open. ──
			const idleMetrics = await readAppMetrics(app);
			const idleRamMb = sumWorkingSetMb(idleMetrics, (m) => isMain(m) || isRenderer(m));
			const idleRendererPidsBefore = new Set(idleMetrics.filter(isRenderer).map((m) => m.pid));

			// ── Per-app renderer RAM: launch one app, find the NEW renderer
			//    process, read its working set. ──
			const newPagePromise = app.waitForEvent("window", { timeout: 30_000 });
			await dashboard.evaluate(
				(appId) =>
					(
						window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
					).brainstorm.apps.launch(appId),
				APP_ID,
			);
			const appWindow = await newPagePromise;
			await waitForFirstContentfulPaintAbsoluteMs(appWindow);
			await appWindow.waitForTimeout(1500); // let the app renderer settle

			const afterLaunch = await readAppMetrics(app);
			const appRenderers = afterLaunch.filter(
				(m) => isRenderer(m) && !idleRendererPidsBefore.has(m.pid),
			);
			const perAppRamMb =
				appRenderers.length > 0 ? Math.max(...appRenderers.map((m) => m.workingSetKib / 1024)) : 0;

			const idleCpuPassed = cpuStats.median < BUDGETS.idleCpu.medianMs;
			const idleRamPassed = idleRamMb < BUDGETS.idleRam.medianMs;
			const perAppRamPassed = perAppRamMb > 0 && perAppRamMb < BUDGETS.perAppRendererRam.medianMs;

			console.log(
				`[perf] idle-cpu: median=${cpuStats.median.toFixed(3)}% p99=${cpuStats.p99.toFixed(3)}% ` +
					`(n=${cpuStats.samples}) budget<${BUDGETS.idleCpu.medianMs}%`,
			);
			console.log(
				`[perf] idle-ram: ${idleRamMb.toFixed(1)}MB (main+dashboard) budget<${BUDGETS.idleRam.medianMs}MB`,
			);
			console.log(
				`[perf] per-app-renderer-ram (${APP_ID}): ${perAppRamMb.toFixed(1)}MB ` +
					`budget<${BUDGETS.perAppRendererRam.medianMs}MB`,
			);

			const oneShot = (n: number): SampleStats => ({
				samples: 1,
				min: n,
				median: n,
				p95: n,
				p99: n,
				max: n,
				mean: n,
			});

			appendResult(
				makeResult({
					spec: "idle-footprint",
					scenario: "idle-cpu",
					budget: BUDGETS.idleCpu,
					stats: cpuStats,
					passed: idleCpuPassed,
					note: idleCpuPassed
						? "idle CPU under budget (percent-of-core, not ms)"
						: "idle CPU over budget — defer to P3 perf-fix iteration",
				}),
			);
			appendResult(
				makeResult({
					spec: "idle-footprint",
					scenario: "idle-ram",
					budget: BUDGETS.idleRam,
					stats: oneShot(idleRamMb),
					passed: idleRamPassed,
					note: idleRamPassed
						? "idle RAM under budget (MB, not ms)"
						: "idle RAM over budget — defer to P3 perf-fix iteration",
				}),
			);
			appendResult(
				makeResult({
					spec: "idle-footprint",
					scenario: `per-app-renderer-ram:${APP_ID}`,
					budget: BUDGETS.perAppRendererRam,
					stats: oneShot(perAppRamMb),
					passed: perAppRamPassed,
					note: perAppRamPassed
						? "per-app renderer RAM under budget (MB, not ms)"
						: "per-app renderer RAM over budget / renderer not found — defer to P3",
				}),
			);

			await appWindow.close();

			expect(appRenderers.length, "no new renderer process appeared after app launch").toBeGreaterThan(
				0,
			);
			expect(cpuStats.median, "idle CPU over budget").toBeLessThan(BUDGETS.idleCpu.medianMs);
			expect(idleRamMb, "idle RAM over budget").toBeLessThan(BUDGETS.idleRam.medianMs);
			expect(perAppRamMb, "per-app renderer RAM over budget").toBeLessThan(
				BUDGETS.perAppRendererRam.medianMs,
			);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
