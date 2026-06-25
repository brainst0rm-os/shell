import { defineConfig } from "@playwright/test";

// Collab-C4-live dogfood harness — two-shell, two-user collaboration sessions.
//
// Separate from the founder (`playwright.dogfood.config.ts`), soak, perf, and
// e2e harnesses. Each spec boots a relay + one shell per teammate (distinct
// identities, separate user-data dirs under `tests/dogfood/.data-collab/`) and
// drives the C1/C2 share flow over the `dev:collab:*` bridge to prove
// multi-user collaboration works end to end through the shipped shell.
//
// No app-build globalSetup: these sessions drive the dev collab bridge from the
// dashboard window and don't open app renderers, so only the shell main+preload
// build is required (`bun run dogfood:collab` builds it first). Serial — each
// spec owns two Electron instances + a relay for its duration.
export default defineConfig({
	testDir: "./tests/dogfood/collab",
	testMatch: /.*\.spec\.ts$/,
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 600_000,
	reporter: [["list"]],
});
