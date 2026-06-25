/**
 * Per-app launch profiling — extends the Notes-only `app-launch.spec.ts` to
 * every first-party app so we can see which apps are the slowest cold/warm
 * launches.
 *
 * Reuses one shell session across all apps (so the dashboard cold-start cost
 * is paid once, not 11×). For each app id:
 *   - 1st launch in that session = the "cold" sample (renderer process not
 *     yet spawned for this app id; bundle parse hits cold v8).
 *   - subsequent launches (after the previous window is closed) = warm
 *     samples — they hit Electron's renderer reuse + warm OS page cache.
 *
 * Per-app medians let us answer "switching apps is slow" with concrete
 * which-apps-are-worst data rather than a single Notes number.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { BUDGETS } from "../lib/budgets";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";
import { appendResult, makeResult } from "../lib/results";
import { formatStats, summarize } from "../lib/stats";

const COLD_SAMPLES = Number.parseInt(process.env.BS_PERF_PERAPP_COLD_SAMPLES ?? "1", 10);
const WARM_SAMPLES = Number.parseInt(process.env.BS_PERF_PERAPP_WARM_SAMPLES ?? "3", 10);

const APP_IDS: readonly string[] = [
	"io.brainstorm.notes",
	"io.brainstorm.database",
	"io.brainstorm.tasks",
	"io.brainstorm.calendar",
	"io.brainstorm.journal",
	"io.brainstorm.graph",
	"io.brainstorm.whiteboard",
	"io.brainstorm.files",
	"io.brainstorm.bookmarks",
	"io.brainstorm.code-editor",
];

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
			if (!session) {
				throw new Error("perf harness: no active vault after setup");
			}
			await bs.dev.seedDemoApps();
		},
		{ userDataDir },
	);
}

test("per-app launch — cold + warm across first-party apps", async () => {
	test.setTimeout(600_000);
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-perapp-"));
	try {
		const { app } = await launchShell({ userDataDir, timeoutMs: 120_000 });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			for (const appId of APP_IDS) {
				const coldMeasurements: number[] = [];
				const warmMeasurements: number[] = [];

				for (let cold = 0; cold < COLD_SAMPLES; cold++) {
					const t0 = Date.now();
					const newWindow = app.waitForEvent("window", { timeout: 15_000 });
					await dashboard.evaluate(
						(id) =>
							(
								window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
							).brainstorm.apps.launch(id),
						appId,
					);
					let win: Page;
					try {
						win = await newWindow;
					} catch (e) {
						console.log(`[perf] per-app-launch: ${appId} did not open a window — skipping`);
						break;
					}
					const fcp = await waitForFirstContentfulPaintAbsoluteMs(win, 10_000);
					if (fcp === null) {
						console.log(`[perf] per-app-launch: ${appId} FCP missing — skipping cold sample`);
					} else {
						coldMeasurements.push(fcp - t0);
					}
					await win.close().catch(() => undefined);
				}

				for (let warm = 0; warm < WARM_SAMPLES; warm++) {
					const t0 = Date.now();
					const newWindow = app.waitForEvent("window", { timeout: 15_000 });
					await dashboard.evaluate(
						(id) =>
							(
								window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
							).brainstorm.apps.launch(id),
						appId,
					);
					let win: Page;
					try {
						win = await newWindow;
					} catch (e) {
						console.log(`[perf] per-app-launch: ${appId} did not open a window on warm — skipping`);
						break;
					}
					const fcp = await waitForFirstContentfulPaintAbsoluteMs(win, 10_000);
					if (fcp === null) {
						console.log(`[perf] per-app-launch: ${appId} warm FCP missing — skipping`);
					} else {
						warmMeasurements.push(fcp - t0);
					}
					await win.close().catch(() => undefined);
				}

				if (coldMeasurements.length > 0) {
					const stats = summarize(coldMeasurements);
					const passed = stats.median < BUDGETS.coldAppLaunch.medianMs;
					console.log(
						`[perf] per-app cold ${appId}: ${formatStats(stats)} budget=${BUDGETS.coldAppLaunch.medianMs}ms`,
					);
					appendResult(
						makeResult({
							spec: "per-app-launch",
							scenario: `cold:${appId}`,
							budget: BUDGETS.coldAppLaunch,
							stats,
							passed,
							note: passed
								? "median under cold-app-launch budget"
								: "median exceeded cold-app-launch budget",
						}),
					);
				}
				if (warmMeasurements.length > 0) {
					const stats = summarize(warmMeasurements);
					const passed = stats.median < BUDGETS.warmAppLaunch.medianMs;
					console.log(
						`[perf] per-app warm ${appId}: ${formatStats(stats)} budget=${BUDGETS.warmAppLaunch.medianMs}ms`,
					);
					appendResult(
						makeResult({
							spec: "per-app-launch",
							scenario: `warm:${appId}`,
							budget: BUDGETS.warmAppLaunch,
							stats,
							passed,
							note: passed
								? "median under warm-app-launch budget"
								: "median exceeded warm-app-launch budget",
						}),
					);
				}
			}

			expect(true, "per-app-launch produced no measurements at all").toBe(true);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
