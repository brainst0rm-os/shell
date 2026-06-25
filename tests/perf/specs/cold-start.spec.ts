/**
 * 12.7 — Cold + warm shell start.
 *
 * Both scenarios paint the Welcome screen on a fresh registry; the warm run
 * reuses the cold run's `--user-data-dir` so OS page cache + the just-built
 * shell bundle are hot, isolating "renderer code on hot cache" from
 * vault-bootstrap cost.
 *
 * Budget: `coldStart` <300ms, `warmStart` <150ms — env-overridable for slower
 * CI hardware (`docs/shell/12-shell-architecture.md §Performance budgets`).
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

const COLD_SAMPLES = Number.parseInt(process.env.BS_PERF_COLD_SAMPLES ?? "5", 10);
const WARM_SAMPLES = Number.parseInt(process.env.BS_PERF_WARM_SAMPLES ?? "5", 10);

test.describe("shell cold + warm start", () => {
	test("cold start to dashboard first paint", async () => {
		const measurements: number[] = [];
		for (let i = 0; i < COLD_SAMPLES; i++) {
			const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-cold-"));
			try {
				const spawnStartedAt = Date.now();
				const { app } = await launchShell({ userDataDir });
				try {
					const page = await app.firstWindow({ timeout: 60_000 });
					const paintWallMs = await waitForFirstContentfulPaintAbsoluteMs(page);
					if (paintWallMs === null) {
						throw new Error("no first-contentful-paint entry captured");
					}
					measurements.push(paintWallMs - spawnStartedAt);
				} finally {
					await app.close();
				}
			} finally {
				rmSync(userDataDir, { recursive: true, force: true });
			}
		}
		const stats = summarize(measurements);
		const passed = stats.median < BUDGETS.coldStart.medianMs;
		console.log(`[perf] cold-start: ${formatStats(stats)} budget=${BUDGETS.coldStart.medianMs}ms`);
		appendResult(
			makeResult({
				spec: "cold-start",
				scenario: "cold",
				budget: BUDGETS.coldStart,
				stats,
				passed,
				note: passed
					? "median under cold-start budget"
					: "median exceeded cold-start budget — defer to P3 perf-fix iteration",
			}),
		);
		expect(stats.median, "cold-start median over budget").toBeLessThan(BUDGETS.coldStart.medianMs);
	});

	test("warm start to dashboard first paint", async () => {
		const userDataDir = mkdtempSync(join(tmpdir(), "bs-perf-warm-"));
		try {
			// Prime the user-data-dir with one cold launch so the registry is
			// initialised on disk; the measured warm samples reuse that state.
			const prime = await launchShell({ userDataDir });
			try {
				const page = await prime.app.firstWindow({ timeout: 60_000 });
				await waitForFirstContentfulPaintAbsoluteMs(page);
			} finally {
				await prime.app.close();
			}

			const measurements: number[] = [];
			for (let i = 0; i < WARM_SAMPLES; i++) {
				const spawnStartedAt = Date.now();
				const { app } = await launchShell({ userDataDir });
				try {
					const page = await app.firstWindow({ timeout: 60_000 });
					const paintWallMs = await waitForFirstContentfulPaintAbsoluteMs(page);
					if (paintWallMs === null) {
						throw new Error("no first-contentful-paint entry captured");
					}
					measurements.push(paintWallMs - spawnStartedAt);
				} finally {
					await app.close();
				}
			}
			const stats = summarize(measurements);
			const passed = stats.median < BUDGETS.warmStart.medianMs;
			console.log(`[perf] warm-start: ${formatStats(stats)} budget=${BUDGETS.warmStart.medianMs}ms`);
			appendResult(
				makeResult({
					spec: "cold-start",
					scenario: "warm",
					budget: BUDGETS.warmStart,
					stats,
					passed,
					note: passed
						? "median under warm-start budget"
						: "median exceeded warm-start budget — defer to P3 perf-fix iteration",
				}),
			);
			expect(stats.median, "warm-start median over budget").toBeLessThan(BUDGETS.warmStart.medianMs);
		} finally {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	});
});
