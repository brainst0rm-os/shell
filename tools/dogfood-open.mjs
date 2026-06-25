#!/usr/bin/env node
/**
 * Open Mira's "Northbound" dogfood vault in a normal, focused window so you
 * can see exactly what the founder loop is doing.
 *
 * It launches the SAME production build the harness drives
 * (`packages/shell/out/main/index.js`) pointed at the SAME persistent
 * user-data dir (`tests/dogfood/.data`) with the SAME insecure-dev
 * credentials — so the vault decrypts and you see Mira's real workspace.
 *
 * IMPORTANT: don't run a founder session (`bun run dogfood`) while this window
 * is open — both processes would open the same SQLite vault and contend. Open
 * to look, close before you run a session (or run the session, then open).
 *
 *   bun run dogfood:open        # build must exist; run `bun run dogfood:build` first if stale
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SHELL_DIR = join(REPO_ROOT, "packages", "shell");
const ELECTRON_BIN = join(SHELL_DIR, "node_modules", ".bin", "electron");
const MAIN_ENTRY = join(SHELL_DIR, "out", "main", "index.js");
const DATA_DIR = join(REPO_ROOT, "tests", "dogfood", ".data");

if (!existsSync(MAIN_ENTRY)) {
	console.error(`No shell build at ${MAIN_ENTRY}.\nRun "bun run dogfood:build" first.`);
	process.exit(1);
}

console.log(`Opening Northbound vault: ${DATA_DIR}`);
const child = spawn(ELECTRON_BIN, [MAIN_ENTRY, `--user-data-dir=${DATA_DIR}`], {
	cwd: SHELL_DIR,
	stdio: "inherit",
	env: {
		...process.env,
		BRAINSTORM_DEV_INSECURE_CREDENTIALS: "1",
		BRAINSTORM_AUTO_SEED: "0",
		NODE_ENV: "production",
	},
});
child.on("exit", (code) => process.exit(code ?? 0));
