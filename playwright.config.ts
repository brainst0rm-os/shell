import { defineConfig } from "@playwright/test";

// 12.7 — Playwright perf harness. Measurement infrastructure only.
//
// NOT wired into the default `bun run test` (which is Vitest under Bun). Perf
// runs are slow + restart Electron between specs; they go through `bun run
// perf`, which is chained to `perf:build` so a stale `packages/shell/out/`
// can't silently skew numbers.
//
// Display requirements:
//   - macOS / Windows: runs unmodified (each Electron window opens on the
//     desktop session).
//   - Linux (CI): wrap the invocation in `xvfb-run --auto-servernum --
//     bun run perf` or set up `Xvfb :99 & export DISPLAY=:99` before running.
//     `launchShell` does not pass `--headless` / `--disable-gpu`; the renderer
//     paint timings change materially with GPU off, so we keep a real display.
//
// Specs live in `tests/perf/specs/`; helpers in `tests/perf/lib/`; baseline
// JSON snapshots land in `tests/perf/results/` (one file per run, ISO-date
// stamped, committed so regression deltas are visible in git history — see
// the matching entry left out of `.gitignore`).
export default defineConfig({
	testDir: "./tests/perf/specs",
	testMatch: /.*\.spec\.ts$/,
	// One worker — every spec launches its own Electron process and writes
	// to its own `--user-data-dir`, so parallelism is moot and would only
	// add CPU contention noise to the medians.
	workers: 1,
	fullyParallel: false,
	// Perf measurements need stable wall-clock; retries would average over
	// noisy runs and hide real regressions. A run either produces a number
	// or fails.
	retries: 0,
	// Long timeout — the editor-keystroke spec types many characters into
	// a real Electron renderer and the cold-start spec waits for a real
	// app boot. Per-test timeouts in specs are tighter.
	timeout: 180_000,
	reporter: [["list"], ["json", { outputFile: "tests/perf/results/playwright-report.json" }]],
});
