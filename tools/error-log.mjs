#!/usr/bin/env node
/**
 * Reader for the runtime error log written by
 * `packages/shell/src/main/diagnostics/error-log.ts`.
 *
 *   bun run logs            # pretty-print recent entries
 *   bun run logs --raw      # raw NDJSON
 *   bun run logs --clear    # truncate after you've fixed everything
 *   bun run logs --errors   # errors only (skip warnings)
 *
 * The path is the fixed home-dir location the sink writes to — no
 * Electron / userData guessing. Used by the `triage-error-log` chore.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_PATH = join(homedir(), ".brainstorm", "logs", "errors.log");
const args = new Set(process.argv.slice(2));

if (args.has("--clear")) {
	if (existsSync(LOG_PATH)) writeFileSync(LOG_PATH, "");
	rmSync(`${LOG_PATH}.1`, { force: true });
	console.log(`cleared ${LOG_PATH}`);
	process.exit(0);
}

if (!existsSync(LOG_PATH)) {
	console.log(`no log yet at ${LOG_PATH}`);
	console.log("(it appears once the shell runs and something logs a warning/error)");
	process.exit(0);
}

const lines = readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean);
const onlyErrors = args.has("--errors");
const raw = args.has("--raw");

console.log(`# ${LOG_PATH}  (${lines.length} entries)\n`);

for (const line of lines) {
	if (raw) {
		console.log(line);
		continue;
	}
	let e;
	try {
		e = JSON.parse(line);
	} catch {
		console.log(line);
		continue;
	}
	if (onlyErrors && e.level !== "error") continue;
	const where = e.source ? ` (${e.source})` : "";
	console.log(`${e.ts}  ${e.level.toUpperCase()}  [${e.scope}]${where}`);
	console.log(`  ${String(e.message).replace(/\n/g, "\n  ")}\n`);
}
