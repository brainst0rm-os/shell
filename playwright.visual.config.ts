/**
 * Visual harness config — isolated from the perf config so visual runs
 * don't share Playwright reporters / timeouts with perf runs.
 *
 * Run via `bun run screenshots`. The spec spawns ONE Electron process and
 * iterates the (app × state × theme) matrix sequentially; concurrency
 * inside Playwright is moot.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/visual/specs",
	testMatch: /.*\.spec\.ts$/,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 30 * 60 * 1000,
	reporter: [["list"]],
});
