/**
 * 12.7 — IPC round-trip latency.
 *
 * Measured from the dashboard renderer over the `windows:list` ipcMain
 * handler — a no-op getter that returns a tiny array. Calling it in a tight
 * loop isolates the bare `ipcRenderer.invoke` → ipcMain → reply round-trip
 * without confounding it with worker-bridge cost or capability-ledger lookups.
 *
 * Why not measure `broker:dispatch` directly: the dashboard does NOT have a
 * broker-registered app id, so we can't call it from the dashboard's
 * `window.brainstorm`. The shell-level RTT measured here is a lower bound on
 * broker RTT (broker adds known sub-ms cap-check overhead); a future iteration
 * measuring real broker RTT would launch an app and time
 * `runtime.services.<service>.<method>` calls.
 *
 * Budget: `ipcRttMedian` <2ms, `ipcRttP99` <8ms
 * (`docs/shell/12-shell-architecture.md §Performance budgets`).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BUDGETS } from "../lib/budgets";
import { launchShell } from "../lib/launch-shell";
import { waitForFirstContentfulPaintAbsoluteMs } from "../lib/measure-paint";
import { appendResult, makeResult } from "../lib/results";
import { formatStats, summarize } from "../lib/stats";

const ITERATIONS = Number.parseInt(process.env.BS_PERF_IPC_ITERATIONS ?? "1000", 10);
const WARMUP = Number.parseInt(process.env.BS_PERF_IPC_WARMUP ?? "100", 10);

test("ipc round-trip latency (windows:list, dashboard → ipcMain)", async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-ipc-"));
	try {
		const { app } = await launchShell({ userDataDir });
		try {
			const page = await app.firstWindow({ timeout: 60_000 });
			await waitForFirstContentfulPaintAbsoluteMs(page);

			const measurements = await page.evaluate(
				async ({ iterations, warmup }) => {
					const api = (
						window as unknown as { brainstorm?: { windows?: { list?: () => Promise<unknown> } } }
					).brainstorm;
					if (!api?.windows?.list) {
						throw new Error("window.brainstorm.windows.list not exposed");
					}
					for (let i = 0; i < warmup; i++) {
						await api.windows.list();
					}
					const out: number[] = [];
					for (let i = 0; i < iterations; i++) {
						const t0 = performance.now();
						await api.windows.list();
						out.push(performance.now() - t0);
					}
					return out;
				},
				{ iterations: ITERATIONS, warmup: WARMUP },
			);

			const stats = summarize(measurements);
			const medianPassed = stats.median < BUDGETS.ipcRttMedian.medianMs;
			const p99Passed = stats.p99 < BUDGETS.ipcRttP99.medianMs;
			console.log(
				`[perf] ipc-rtt (n=${stats.samples}): ${formatStats(stats)} ` +
					`budget median<${BUDGETS.ipcRttMedian.medianMs}ms p99<${BUDGETS.ipcRttP99.medianMs}ms`,
			);
			appendResult(
				makeResult({
					spec: "ipc-rtt",
					scenario: "median",
					budget: BUDGETS.ipcRttMedian,
					stats,
					passed: medianPassed,
					note: medianPassed
						? "median under IPC RTT budget"
						: "median exceeded IPC RTT budget — defer to P3 perf-fix iteration",
				}),
			);
			appendResult(
				makeResult({
					spec: "ipc-rtt",
					scenario: "p99",
					budget: BUDGETS.ipcRttP99,
					stats,
					passed: p99Passed,
					note: p99Passed
						? "p99 under IPC RTT budget"
						: "p99 exceeded IPC RTT budget — defer to P3 perf-fix iteration",
				}),
			);
			expect(stats.median, "IPC RTT median over budget").toBeLessThan(BUDGETS.ipcRttMedian.medianMs);
			expect(stats.p99, "IPC RTT p99 over budget").toBeLessThan(BUDGETS.ipcRttP99.medianMs);
		} finally {
			await app.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
});
