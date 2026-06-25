import { defineConfig } from "@playwright/test";

// 14.34 — real-shell catalog dogfood. Launches the production-built Electron
// shell pointed at a locally-served first-party catalog and installs a
// not-installed app through the marketplace IPC, proving Electron's net.fetch +
// the install/update IPC work end-to-end (the gap node-fetch stood in for).
//
// Run via `bun run dogfood:catalog` (chained to a build). Single worker — it
// launches its own Electron process against its own --user-data-dir.
export default defineConfig({
	testDir: "./tests/dogfood",
	testMatch: /catalog-install\.spec\.ts$/,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 240_000,
	reporter: [["list"]],
});
