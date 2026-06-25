/**
 * Structured perf-result writer. Every spec calls `recordResult` after each
 * measurement; on session end the aggregated JSON is flushed to
 * `tests/perf/results/<ISO-date>.json`.
 *
 * The file shape is intentionally flat + diff-friendly: one top-level entry
 * per (spec × scenario), each carrying its sample stats, the budget it was
 * compared against, and whether it passed. Reviewers / future P3 fix
 * iterations grep for `"passed": false` to find regressions.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Budget } from "./budgets";
import type { SampleStats } from "./stats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const RESULTS_DIR = join(REPO_ROOT, "tests", "perf", "results");

export type PerfResult = {
	readonly spec: string;
	readonly scenario: string;
	readonly budget: {
		readonly id: string;
		readonly description: string;
		readonly medianMs: number;
	};
	readonly stats: SampleStats;
	readonly passed: boolean;
	readonly note?: string;
};

export type PerfReport = {
	readonly recordedAt: string;
	readonly env: {
		readonly platform: string;
		readonly release: string;
		readonly hostname: string;
		readonly node: string;
		readonly arch: string;
	};
	readonly results: readonly PerfResult[];
};

export function makeResult(args: {
	spec: string;
	scenario: string;
	budget: Budget;
	stats: SampleStats;
	passed: boolean;
	note?: string;
}): PerfResult {
	return args.note !== undefined
		? {
				spec: args.spec,
				scenario: args.scenario,
				budget: {
					id: args.budget.id,
					description: args.budget.description,
					medianMs: args.budget.medianMs,
				},
				stats: args.stats,
				passed: args.passed,
				note: args.note,
			}
		: {
				spec: args.spec,
				scenario: args.scenario,
				budget: {
					id: args.budget.id,
					description: args.budget.description,
					medianMs: args.budget.medianMs,
				},
				stats: args.stats,
				passed: args.passed,
			};
}

function todayIso(): string {
	const d = new Date();
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function reportPath(): string {
	return join(RESULTS_DIR, `${todayIso()}.json`);
}

export function appendResult(result: PerfResult): void {
	const path = reportPath();
	mkdirSync(dirname(path), { recursive: true });
	let existing: PerfReport | null = null;
	try {
		existing = JSON.parse(readFileSync(path, "utf8")) as PerfReport;
	} catch {
		existing = null;
	}
	const report: PerfReport = {
		recordedAt: new Date().toISOString(),
		env: {
			platform: platform(),
			release: release(),
			hostname: hostname(),
			node: process.version,
			arch: process.arch,
		},
		results: [...(existing?.results ?? []), result],
	};
	writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
