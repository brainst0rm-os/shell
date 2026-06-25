/**
 * 12.7 — App launch time (cold + warm).
 *
 * Cold = first launch of an app id this shell session. The app renderer is
 *   spawned fresh; preload + bundle parse + first paint all run.
 * Warm = relaunch of the same app id after closing its window. Per
 *   `docs/shell/12-shell-architecture.md:103` the shell *may* keep
 *   recently-used renderers alive; whether or not it does, the second
 *   launch goes through the warm path (registry hot, dashboard wired up,
 *   resources cached).
 *
 * Budgets: `coldAppLaunch` <800ms, `warmAppLaunch` <200ms.
 *
 * Measurement: from the dashboard renderer we call
 * `window.brainstorm.apps.launch(appId)` and capture a wall-clock t0; the
 * app's new BrowserWindow is then surfaced via `electronApp.waitForEvent`
 * and we read its `first-contentful-paint` absolute time. Delta = launch
 * latency.
 *
 * This spec is gated on a vault being already created + apps seeded — that
 * setup is one-time at the top of the spec.
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

const COLD_SAMPLES = Number.parseInt(process.env.BS_PERF_APP_COLD_SAMPLES ?? "10", 10);
const WARM_SAMPLES = Number.parseInt(process.env.BS_PERF_APP_WARM_SAMPLES ?? "10", 10);
/** Notes is the most pessimistic first-party app to launch (mounts a Lexical
 *  editor + Yjs binding on an empty doc), so the cold/warm numbers measured
 *  here are an upper-bound regression baseline. */
const APP_ID = "io.brainstorm.notes";

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

test("app launch — cold + warm (Notes)", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-applaunch-"));
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const dashboard = await app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(dashboard);
			await ensureVaultAndSeed(dashboard, userDataDir);

			const coldMeasurements: number[] = [];
			const warmMeasurements: number[] = [];

			for (let cold = 0; cold < COLD_SAMPLES; cold++) {
				const cold0 = Date.now();
				const newPagePromise = app.waitForEvent("window", { timeout: 30_000 });
				await dashboard.evaluate(
					(appId) =>
						(
							window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
						).brainstorm.apps.launch(appId),
					APP_ID,
				);
				const appWindow = await newPagePromise;
				const fcp = await waitForFirstContentfulPaintAbsoluteMs(appWindow);
				if (fcp === null) throw new Error("app FCP missing");
				coldMeasurements.push(fcp - cold0);

				// Per `docs/shell/12-shell-architecture.md:103` the shell may
				// keep renderers warm; the second launch is the warm case
				// regardless of whether the process was actually retained.
				await appWindow.close();
			}

			for (let warm = 0; warm < WARM_SAMPLES; warm++) {
				const warm0 = Date.now();
				const newPagePromise = app.waitForEvent("window", { timeout: 30_000 });
				await dashboard.evaluate(
					(appId) =>
						(
							window as unknown as { brainstorm: { apps: { launch: (id: string) => Promise<void> } } }
						).brainstorm.apps.launch(appId),
					APP_ID,
				);
				const appWindow = await newPagePromise;
				const fcp = await waitForFirstContentfulPaintAbsoluteMs(appWindow);
				if (fcp === null) throw new Error("app FCP missing");
				warmMeasurements.push(fcp - warm0);
				await appWindow.close();
			}

			const coldStats = summarize(coldMeasurements);
			const warmStats = summarize(warmMeasurements);
			const coldPassed = coldStats.median < BUDGETS.coldAppLaunch.medianMs;
			const warmPassed = warmStats.median < BUDGETS.warmAppLaunch.medianMs;
			console.log(
				`[perf] app-launch cold (${APP_ID}): ${formatStats(coldStats)} budget=${BUDGETS.coldAppLaunch.medianMs}ms`,
			);
			console.log(
				`[perf] app-launch warm (${APP_ID}): ${formatStats(warmStats)} budget=${BUDGETS.warmAppLaunch.medianMs}ms`,
			);
			appendResult(
				makeResult({
					spec: "app-launch",
					scenario: `cold:${APP_ID}`,
					budget: BUDGETS.coldAppLaunch,
					stats: coldStats,
					passed: coldPassed,
					note: coldPassed
						? "median under cold-app-launch budget"
						: "median exceeded cold-app-launch budget — defer to P3 perf-fix iteration",
				}),
			);
			appendResult(
				makeResult({
					spec: "app-launch",
					scenario: `warm:${APP_ID}`,
					budget: BUDGETS.warmAppLaunch,
					stats: warmStats,
					passed: warmPassed,
					note: warmPassed
						? "median under warm-app-launch budget"
						: "median exceeded warm-app-launch budget — defer to P3 perf-fix iteration",
				}),
			);
			expect(coldStats.median, "cold app-launch median over budget").toBeLessThan(
				BUDGETS.coldAppLaunch.medianMs,
			);
			expect(warmStats.median, "warm app-launch median over budget").toBeLessThan(
				BUDGETS.warmAppLaunch.medianMs,
			);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
