/**
 * error-log — one append-only sink for every renderer / app / main-process
 * error, so debugging stops being a ping-pong of "paste me the console".
 *
 * WHY this exists: a pasted stack trace from a sandboxed app renderer is
 * unreadable in isolation, so every bug became a round of "send me the error
 * again". This module captures `console-message`, `render-process-gone`,
 * `preload-error` and `did-fail-load` from *every* `WebContents` (shell + all
 * app windows) plus main-process `uncaughtException` / `unhandledRejection`,
 * and writes them as NDJSON to a fixed, easy-to-find path.
 *
 * App bundles are minified (apps/vite.config.base.ts — an app's eager chunk is
 * parsed on every window open, so unminified renderers were the app-open
 * latency cost), so a captured frame reads `index-<hash>.js:1:N` rather than
 * real file:line. A `.map` is emitted next to each bundle in the app's *source*
 * `dist/`, but `main/apps/bundle-filter.ts` strips maps from the installed copy
 * the running app serves — so this log does NOT resolve frames to source. To
 * read a trace, load the matching `.map` from the source `dist/` by hand.
 *
 * The path is deliberately a stable home-dir location (NOT Electron's
 * `userData`, which is derived from the package name and would also
 * relocate the vault registry if we touched the app name): the
 * `bun run logs` CLI and the `triage-error-log` chore both read exactly
 * this path with zero guessing.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebContents } from "electron";

export const ERROR_LOG_DIR = join(homedir(), ".brainstorm", "logs");
export const ERROR_LOG_PATH = join(ERROR_LOG_DIR, "errors.log");

/** Rotate to `errors.log.1` past this size so a single runaway loop can't
 *  grow the file unbounded, while one prior session stays available. */
const MAX_BYTES = 2_000_000;

export enum LogLevel {
	Warn = "warn",
	Error = "error",
}

export type LogEntry = {
	ts: string;
	level: LogLevel;
	scope: string;
	message: string;
	source?: string;
};

/** Pure: serialise one entry to a single NDJSON line. Exported for tests
 *  and reused by the `bun run logs` reader. */
export function formatEntry(entry: LogEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

/** Pure: should we rotate given the current size and the incoming line?
 *  Split out so the size policy is unit-testable without touching disk. */
export function shouldRotate(currentBytes: number, incomingBytes: number): boolean {
	return currentBytes > 0 && currentBytes + incomingBytes > MAX_BYTES;
}

let rotatedThisRun = false;

function write(entry: LogEntry): void {
	const line = formatEntry(entry);
	try {
		mkdirSync(ERROR_LOG_DIR, { recursive: true });
		let size = 0;
		try {
			size = statSync(ERROR_LOG_PATH).size;
		} catch {
			size = 0;
		}
		if (!rotatedThisRun && shouldRotate(size, Buffer.byteLength(line))) {
			renameSync(ERROR_LOG_PATH, `${ERROR_LOG_PATH}.1`);
			rotatedThisRun = true;
		}
		appendFileSync(ERROR_LOG_PATH, line);
	} catch {
		// The diagnostics sink must never throw into the path it's
		// observing — a failed log write is silently dropped.
	}
}

/** Record one error/warning. Safe to call from anywhere in main. */
export function logDiagnostic(
	level: LogLevel,
	scope: string,
	message: string,
	source?: string,
): void {
	write({
		ts: new Date().toISOString(),
		level,
		scope,
		message: message.length > 8000 ? `${message.slice(0, 8000)}…[truncated]` : message,
		...(source ? { source } : {}),
	});
}

/** Electron ≥35 delivers `console-message` as a single event object;
 *  older builds used positional args. Normalise both. */
type ConsoleMessageEventLike = {
	level?: string | number;
	message?: string;
	lineNumber?: number;
	sourceId?: string;
};

export function normalizeConsoleMessage(
	args: unknown[],
): { level: LogLevel; message: string; source?: string } | null {
	const first = args[0] as ConsoleMessageEventLike | undefined;
	let rawLevel: string | number | undefined;
	let message = "";
	let line: number | undefined;
	let sourceId: string | undefined;

	if (args.length >= 4 && typeof args[2] === "string") {
		// Legacy: (event, level:number, message, line, sourceId)
		rawLevel = args[1] as number;
		message = args[2] as string;
		line = args[3] as number;
		sourceId = args[4] as string | undefined;
	} else if (first && typeof first === "object") {
		rawLevel = first.level;
		message = first.message ?? "";
		line = first.lineNumber;
		sourceId = first.sourceId;
	} else {
		return null;
	}

	// Only warnings and errors are worth persisting; info/log/debug would
	// drown the signal (the very chatter that hid the real failures).
	const isError = rawLevel === "error" || rawLevel === 3;
	const isWarn = rawLevel === "warning" || rawLevel === 2;
	if (!isError && !isWarn) return null;

	const source = sourceId && line !== undefined ? `${sourceId}:${line}` : (sourceId ?? undefined);
	return { level: isError ? LogLevel.Error : LogLevel.Warn, message, ...(source ? { source } : {}) };
}

/** Derive a short scope label from a webContents URL — `apps/<id>/dist/…`
 *  or the shell renderer — so log lines say *which* surface failed. */
function scopeFor(wc: WebContents): string {
	let url = "";
	try {
		url = wc.getURL();
	} catch {
		url = "";
	}
	const appMatch = url.match(/apps[/\\]([^/\\]+)[/\\]/);
	if (appMatch?.[1]) return `app:${appMatch[1]}`;
	if (url.includes("/renderer/")) return "shell-renderer";
	return "renderer";
}

const attached = new WeakSet<WebContents>();

/** Wire one WebContents. Idempotent — safe if called twice for the same
 *  contents (the `web-contents-created` hook plus any explicit call). */
export function attachWebContentsLogging(wc: WebContents): void {
	if (attached.has(wc)) return;
	attached.add(wc);

	wc.on("console-message", (...args: unknown[]) => {
		const parsed = normalizeConsoleMessage(args);
		if (parsed) logDiagnostic(parsed.level, scopeFor(wc), parsed.message, parsed.source);
	});

	wc.on("render-process-gone", (_event, details) => {
		logDiagnostic(
			LogLevel.Error,
			scopeFor(wc),
			`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`,
		);
	});

	wc.on("preload-error", (_event, preloadPath, error) => {
		logDiagnostic(
			LogLevel.Error,
			scopeFor(wc),
			`preload-error in ${preloadPath}: ${error?.stack ?? error?.message ?? String(error)}`,
		);
	});

	wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		// -3 is ERR_ABORTED — a normal consequence of fast navigation /
		// window teardown, not a failure worth logging.
		if (errorCode === -3) return;
		logDiagnostic(
			LogLevel.Error,
			scopeFor(wc),
			`did-fail-load ${errorCode} ${errorDescription} (${validatedURL})`,
		);
	});
}

let mainInstalled = false;

/** Capture main-process crashes + tee `console.error` / `console.warn`
 *  to the same sink so a single file holds the whole picture. */
export function installMainProcessLogging(): void {
	if (mainInstalled) return;
	mainInstalled = true;

	process.on("uncaughtException", (error) => {
		logDiagnostic(LogLevel.Error, "main", `uncaughtException: ${error.stack ?? error.message}`);
	});
	process.on("unhandledRejection", (reason) => {
		const r = reason as Error;
		logDiagnostic(
			LogLevel.Error,
			"main",
			`unhandledRejection: ${r?.stack ?? r?.message ?? String(reason)}`,
		);
	});

	const origError = console.error.bind(console);
	const origWarn = console.warn.bind(console);
	console.error = (...a: unknown[]) => {
		logDiagnostic(LogLevel.Error, "main", a.map(stringifyArg).join(" "));
		origError(...a);
	};
	console.warn = (...a: unknown[]) => {
		logDiagnostic(LogLevel.Warn, "main", a.map(stringifyArg).join(" "));
		origWarn(...a);
	};
}

function stringifyArg(a: unknown): string {
	if (a instanceof Error) return a.stack ?? a.message;
	if (typeof a === "string") return a;
	try {
		return JSON.stringify(a);
	} catch {
		return String(a);
	}
}
