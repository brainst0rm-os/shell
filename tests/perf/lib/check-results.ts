/**
 * 12.7 step 2 — perf-report aggregator.
 *
 * Each Playwright spec writes one or more `PerfResult` entries into the
 * day's `tests/perf/results/<date>.json` (see `results.ts`). The per-test
 * `expect(...).toBeLessThan(budget)` already gates a single spec, but it
 * can't see two things the build needs to fail on:
 *
 *   1. A regression that landed as `passed:false` in a spec that was run
 *      but whose `expect` was relaxed or removed by accident.
 *   2. A budget id from `BUDGETS` that has *no* producing spec in the
 *      report at all — typically because someone skipped a spec or never
 *      wrote one. Per-test assertions can't catch this; only an aggregator
 *      over the whole report can.
 *
 * `evaluateReport` is the pure function the CI gate runs. The CLI at the
 * bottom reads the latest report from `tests/perf/results/` (or
 * `BS_PERF_REPORT_PATH` when overridden), prints a one-line summary per
 * spec, and exits non-zero on any failure or missing budget.
 *
 * Pure module; no Playwright import, no Electron. Safe to unit-test under
 * vitest.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGETS } from "./budgets";
import type { PerfReport, PerfResult } from "./results";

export type EvaluateOutcome = {
	readonly total: number;
	readonly failures: readonly PerfResult[];
	readonly missingSpecs: readonly string[];
};

/**
 * Evaluates a perf report against the set of expected budget ids.
 *
 *   - `total` — number of results in the report (informational).
 *   - `failures` — every result whose `passed` flag is false.
 *   - `missingSpecs` — every expected budget id with no producing result.
 *
 * The build fails (`exit 1`) when `failures.length > 0 || missingSpecs.length > 0`.
 * Both conditions are surfaced separately so the CLI can print actionable
 * messages ("missing scenario X" vs "regression in spec Y").
 */
export function evaluateReport(
	report: PerfReport,
	expectedBudgetIds: readonly string[],
): EvaluateOutcome {
	const results = report.results ?? [];
	const failures = results.filter((r) => !r.passed);
	const seenBudgetIds = new Set(results.map((r) => r.budget.id));
	const missingSpecs = expectedBudgetIds.filter((id) => !seenBudgetIds.has(id));
	return {
		total: results.length,
		failures,
		missingSpecs,
	};
}

export type ReportLocator = {
	readonly path: string;
	readonly report: PerfReport;
};

/**
 * Picks the report to evaluate.
 *
 * Precedence: explicit `BS_PERF_REPORT_PATH` env var → newest-mtime file in
 * `tests/perf/results/` (matching `YYYY-MM-DD.json`). Returns null if no
 * report is found — the CLI treats that as a fatal "no perf data" error.
 */
export function locateLatestReport(resultsDir: string): ReportLocator | null {
	const override = process.env.BS_PERF_REPORT_PATH;
	if (override) {
		const report = JSON.parse(readFileSync(override, "utf8")) as PerfReport;
		return { path: override, report };
	}
	let candidates: string[];
	try {
		candidates = readdirSync(resultsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
	} catch {
		return null;
	}
	if (candidates.length === 0) return null;
	let newestPath: string | null = null;
	let newestMtimeMs = Number.NEGATIVE_INFINITY;
	for (const name of candidates) {
		const full = join(resultsDir, name);
		const m = statSync(full).mtimeMs;
		if (m > newestMtimeMs) {
			newestMtimeMs = m;
			newestPath = full;
		}
	}
	if (!newestPath) return null;
	const report = JSON.parse(readFileSync(newestPath, "utf8")) as PerfReport;
	return { path: newestPath, report };
}

/**
 * Renders a stable, one-line-per-event summary suitable for a CI log.
 * Pure (no console.log), so unit tests can pin the exact wording.
 */
export function formatOutcome(outcome: EvaluateOutcome, reportPath: string): string {
	const lines: string[] = [];
	lines.push(`[perf:check] report=${reportPath}`);
	lines.push(
		`[perf:check] results=${outcome.total} failures=${outcome.failures.length} missing=${outcome.missingSpecs.length}`,
	);
	for (const f of outcome.failures) {
		lines.push(
			`[perf:check] FAIL ${f.spec}/${f.scenario} budget=${f.budget.id} medianBudgetMs=${f.budget.medianMs} measuredMedianMs=${f.stats.median.toFixed(2)}`,
		);
	}
	for (const id of outcome.missingSpecs) {
		lines.push(`[perf:check] MISSING budget=${id} (no spec produced a result for it)`);
	}
	if (outcome.failures.length === 0 && outcome.missingSpecs.length === 0) {
		lines.push("[perf:check] PASS");
	}
	return lines.join("\n");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const RESULTS_DIR = join(REPO_ROOT, "tests", "perf", "results");

async function main(): Promise<number> {
	const located = locateLatestReport(RESULTS_DIR);
	if (!located) {
		console.error(
			`[perf:check] FATAL no perf report found in ${RESULTS_DIR} (set BS_PERF_REPORT_PATH or run \`bun run perf\` first).`,
		);
		return 1;
	}
	const expected = Object.values(BUDGETS).map((b) => b.id);
	const outcome = evaluateReport(located.report, expected);
	const text = formatOutcome(outcome, located.path);
	if (outcome.failures.length === 0 && outcome.missingSpecs.length === 0) {
		console.log(text);
		return 0;
	}
	console.error(text);
	return 1;
}

// `import.meta.main` is Bun-specific; the script is invoked via
// `bun run tests/perf/lib/check-results.ts` per `package.json`.
if ((import.meta as unknown as { main?: boolean }).main) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error("[perf:check] FATAL", err);
			process.exit(1);
		},
	);
}
