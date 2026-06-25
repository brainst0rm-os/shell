/**
 * Stage 10.9a — soak harness Playwright config. Distinct from the perf
 * harness (`playwright.config.ts`) because soak runs are minutes-to-hours
 * long and assert different properties (convergence + ciphertext-only +
 * memory slope), not paint timings.
 *
 * Selected by `BS_SOAK_MIN` (15 default / 30 / 480). The 8 h endurance
 * mode (`480`) bumps the test timeout inline; the config ceiling here is
 * 2 h to keep PR-gate + nightly runs sane.
 *
 *   `BS_SOAK_MIN=15 bun run soak`     # PR-gate smoke
 *   `BS_SOAK_MIN=30 bun run soak`     # extended soak
 *   `BS_SOAK_MIN=480 bun run soak`    # 8 h endurance (release-blocking)
 *
 * Display requirements mirror the perf harness — see
 * `playwright.config.ts` for the macOS / Windows / Linux setup. The soak
 * launches two Electron processes concurrently, so the host needs
 * enough display + CPU headroom for both renderers to run for the soak
 * window without throttling.
 *
 * Workers = 1, fullyParallel = false: the spec spawns its own relay +
 * its own pair of Electron processes; parallelism would only contend on
 * memory + the ephemeral port pool.
 */

import { defineConfig } from "@playwright/test";

const SOAK_MINUTES = Number(process.env.BS_SOAK_MIN ?? "15");
const baseTimeoutMs = 2 * 60 * 60 * 1000;
const longSoakBumpMs = SOAK_MINUTES > 60 ? (SOAK_MINUTES + 30) * 60 * 1000 : 0;

export default defineConfig({
	testDir: "./tests/soak/specs",
	testMatch: /.*\.spec\.ts$/,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: Math.max(baseTimeoutMs, longSoakBumpMs),
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile: `tests/soak/results/${new Date().toISOString().slice(0, 10)}.json`,
			},
		],
	],
	outputDir: "tests/soak/_artifacts",
});
