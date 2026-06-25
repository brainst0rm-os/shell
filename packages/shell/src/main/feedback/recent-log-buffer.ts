/**
 * Feedback-1 — in-memory rolling console-log ring buffer.
 *
 * Subscribes to every `WebContents.on("console-message", …)` event and
 * keeps the most recent ~64 KiB of warning + error messages so the
 * feedback dialog can offer a "Include recent log" toggle that doesn't
 * require persisting anything on disk. Independent of
 * `diagnostics/error-log.ts` (which writes NDJSON to `~/.brainstorm/logs`
 * for triage); this buffer is purely RAM-resident and survives only as
 * long as the shell process.
 *
 * The buffer is byte-bounded (not line-bounded) so a single rogue log
 * line can't push the total past the cap. When a new line would push
 * the total past the cap, the oldest line(s) drop until the new line
 * fits.
 *
 * Levels captured: warn + error only. Info / log / debug are too noisy
 * to surface to staff and would crowd out the real signal. Matches
 * `error-log.ts`'s filtering.
 */

import { type LogLevel, normalizeConsoleMessage } from "../diagnostics/error-log";

/** 64 KiB matches `feedback-payload.ts:RECENT_LOG_MAX_BYTES` so the
 *  buffer can't grow past what a single report would carry. */
export const RECENT_LOG_BUFFER_BYTES = 64 * 1024;

export type RecentLogLine = {
	readonly ts: number;
	readonly level: LogLevel;
	readonly scope: string;
	readonly message: string;
};

export class RecentLogBuffer {
	private readonly lines: RecentLogLine[] = [];
	private bytes = 0;
	private readonly maxBytes: number;
	private readonly now: () => number;

	constructor(options: { maxBytes?: number; now?: () => number } = {}) {
		this.maxBytes = options.maxBytes ?? RECENT_LOG_BUFFER_BYTES;
		this.now = options.now ?? Date.now;
	}

	/** Append a console line to the buffer. Pure / side-effect-free apart
	 *  from the internal array; safe to call from any tick. */
	append(line: { level: LogLevel; scope: string; message: string }): void {
		const entry: RecentLogLine = {
			ts: this.now(),
			level: line.level,
			scope: line.scope,
			message: line.message,
		};
		const lineBytes = lineLength(entry);
		this.lines.push(entry);
		this.bytes += lineBytes;
		while (this.bytes > this.maxBytes && this.lines.length > 1) {
			const dropped = this.lines.shift();
			if (dropped) this.bytes -= lineLength(dropped);
		}
	}

	/** Read the buffer as a flat string. Caller decides what to do with
	 *  it (the feedback service hands it to `redactPayload` next). */
	read(): string {
		return this.lines.map(formatLine).join("\n");
	}

	get sizeBytes(): number {
		return this.bytes;
	}

	get lineCount(): number {
		return this.lines.length;
	}

	clear(): void {
		this.lines.length = 0;
		this.bytes = 0;
	}

	/** Wire one WebContents. Pulls warning + error console-message events
	 *  via the same `normalizeConsoleMessage` the diagnostics sink uses,
	 *  so capture filtering stays consistent across surfaces. */
	attach(
		wc: { on: (event: "console-message", listener: (...args: unknown[]) => void) => unknown },
		scope: string,
	): void {
		wc.on("console-message", (...args: unknown[]) => {
			const parsed = normalizeConsoleMessage(args);
			if (!parsed) return;
			this.append({ level: parsed.level, scope, message: parsed.message });
		});
	}
}

function formatLine(line: RecentLogLine): string {
	const iso = new Date(line.ts).toISOString();
	return `${iso} [${line.level}] (${line.scope}) ${line.message}`;
}

function lineLength(line: RecentLogLine): number {
	return formatLine(line).length + 1; // +1 for the joining newline
}

let sharedBuffer: RecentLogBuffer | null = null;

/** Process-singleton accessor used by the `web-contents-created` hook
 *  in `main/index.ts`. Constructed lazily so tests that import the
 *  module without spawning the shell don't allocate the buffer. */
export function getSharedRecentLogBuffer(): RecentLogBuffer {
	if (!sharedBuffer) sharedBuffer = new RecentLogBuffer();
	return sharedBuffer;
}

/** Reset for tests — drops the singleton so the next `get` mints a
 *  fresh empty buffer. */
export function __resetSharedRecentLogBufferForTests(): void {
	sharedBuffer = null;
}

/** Scope deriver matching `diagnostics/error-log.ts:scopeFor` so the
 *  two surfaces label the same webContents identically. */
export function scopeForUrl(url: string): string {
	const appMatch = url.match(/apps[/\\]([^/\\]+)[/\\]/);
	if (appMatch?.[1]) return `app:${appMatch[1]}`;
	if (url.includes("/renderer/")) return "shell-renderer";
	return "renderer";
}
