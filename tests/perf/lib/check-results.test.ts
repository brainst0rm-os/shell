/**
 * 12.7 step 2 — units for the perf-report aggregator.
 *
 * Pins the two failure modes the aggregator was built for:
 *
 *   1. `passed:false` → fails (covers the "spec ran, regression caught"
 *      path even if a per-test `expect` was relaxed).
 *   2. expected-budget id absent from the report → fails (covers the
 *      "spec was skipped" path the per-test assertion can't see).
 *
 * Plus combinations: empty report, all-pass, mixed pass/fail/missing.
 */

import { describe, expect, it } from "vitest";
import { evaluateReport, formatOutcome } from "./check-results";
import type { PerfReport, PerfResult } from "./results";

const ENV = {
	platform: "linux",
	release: "test",
	hostname: "test",
	node: "v0.0.0",
	arch: "x64",
};

function result(spec: string, scenario: string, budgetId: string, passed: boolean): PerfResult {
	return {
		spec,
		scenario,
		budget: { id: budgetId, description: "test", medianMs: 100 },
		stats: { samples: 1, min: 0, median: 0, p95: 0, p99: 0, max: 0, mean: 0 },
		passed,
	};
}

function report(results: PerfResult[]): PerfReport {
	return { recordedAt: "2026-05-25T00:00:00.000Z", env: ENV, results };
}

describe("evaluateReport", () => {
	it("returns no failures and no missing when every expected budget passes", () => {
		const rpt = report([
			result("cold-start", "cold", "cold-start-to-dashboard-first-paint", true),
			result("ipc-rtt", "median", "ipc-rtt-median", true),
		]);
		const outcome = evaluateReport(rpt, ["cold-start-to-dashboard-first-paint", "ipc-rtt-median"]);
		expect(outcome.total).toBe(2);
		expect(outcome.failures).toEqual([]);
		expect(outcome.missingSpecs).toEqual([]);
	});

	it("collects failures from results with passed:false", () => {
		const failing = result("editor-keystroke", "empty-doc", "editor-keystroke-to-paint", false);
		const rpt = report([
			result("cold-start", "cold", "cold-start-to-dashboard-first-paint", true),
			failing,
		]);
		const outcome = evaluateReport(rpt, [
			"cold-start-to-dashboard-first-paint",
			"editor-keystroke-to-paint",
		]);
		expect(outcome.failures).toEqual([failing]);
		expect(outcome.missingSpecs).toEqual([]);
	});

	it("flags expected budget ids that have no producing result", () => {
		const rpt = report([result("cold-start", "cold", "cold-start-to-dashboard-first-paint", true)]);
		const outcome = evaluateReport(rpt, [
			"cold-start-to-dashboard-first-paint",
			"editor-keystroke-to-paint",
		]);
		expect(outcome.failures).toEqual([]);
		expect(outcome.missingSpecs).toEqual(["editor-keystroke-to-paint"]);
	});

	it("treats an empty report as every expected budget missing", () => {
		const outcome = evaluateReport(report([]), ["a", "b", "c"]);
		expect(outcome.total).toBe(0);
		expect(outcome.failures).toEqual([]);
		expect(outcome.missingSpecs).toEqual(["a", "b", "c"]);
	});

	it("reports failures and missing budgets independently in a mixed run", () => {
		const failing = result("ipc-rtt", "p99", "ipc-rtt-p99", false);
		const rpt = report([
			result("cold-start", "cold", "cold-start-to-dashboard-first-paint", true),
			failing,
		]);
		const outcome = evaluateReport(rpt, [
			"cold-start-to-dashboard-first-paint",
			"ipc-rtt-p99",
			"editor-keystroke-to-paint",
		]);
		expect(outcome.failures).toEqual([failing]);
		expect(outcome.missingSpecs).toEqual(["editor-keystroke-to-paint"]);
	});
});

describe("formatOutcome", () => {
	it("emits PASS when the outcome is clean", () => {
		const text = formatOutcome({ total: 1, failures: [], missingSpecs: [] }, "/tmp/r.json");
		expect(text).toContain("report=/tmp/r.json");
		expect(text).toContain("results=1 failures=0 missing=0");
		expect(text).toContain("[perf:check] PASS");
	});

	it("emits a FAIL line per failure with spec/scenario/budget context", () => {
		const failing = result("ipc-rtt", "p99", "ipc-rtt-p99", false);
		const text = formatOutcome({ total: 1, failures: [failing], missingSpecs: [] }, "/tmp/r.json");
		expect(text).toContain("FAIL ipc-rtt/p99 budget=ipc-rtt-p99");
		expect(text).not.toContain("[perf:check] PASS");
	});

	it("emits a MISSING line per missing budget id", () => {
		const text = formatOutcome(
			{ total: 0, failures: [], missingSpecs: ["editor-keystroke-to-paint"] },
			"/tmp/r.json",
		);
		expect(text).toContain("MISSING budget=editor-keystroke-to-paint");
		expect(text).not.toContain("[perf:check] PASS");
	});
});
