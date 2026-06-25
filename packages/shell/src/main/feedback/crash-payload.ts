/**
 * Feedback-2 — crash-payload keystone.
 *
 * Pure (no Electron, no fs, no network) — the `CrashReporterService` in
 * `crash-reporter-service.ts` composes this with the Electron hooks +
 * `CrashQueue` + the network broker. UI bound to this surface (the
 * pending-list preview Popover) consumes only the types + enums +
 * helpers exported here.
 *
 * Mirrors `feedback-payload.ts` byte-for-byte on the redactor rules
 * (vault → `<vault>`, home → `<home>/`, credential keys → `<credential>`,
 * emails → `<email>`) so a crash report leaks no more than a bug report
 * does — the user reads a single sentence ("Crash reports include the
 * last 64 KiB of the console log and the stack trace, both with paths
 * and emails redacted") and gets exactly that.
 *
 * Crash reports are **always anonymous** — there is no `contactEmail`
 * field. The user opted in once; we don't re-prompt per crash.
 * Stack-frame paths are redacted in place (the rebuilt stack string
 * still parses as a stack trace; we only swap the file path prefix).
 * `message` is truncated to 1024 chars (a stack overflow can produce a
 * megabyte-long message); `stack` to 32 KiB.
 */

/** Cause of the crash. String values are wire-stable; enum keys are the
 *  in-code reference per [[feedback_enums_not_string_constants]]. */
export enum CrashKind {
	UncaughtException = "uncaught-exception",
	UnhandledRejection = "unhandled-rejection",
	RendererProcessGone = "renderer-process-gone",
	RendererCrashed = "renderer-crashed",
	RendererKilled = "renderer-killed",
	UnresponsiveRenderer = "unresponsive-renderer",
	MainProcessGone = "main-process-gone",
}

/** Electron `RenderProcessGoneDetails.reason` mirror. The `Crashed`
 *  variant is the noisy-renderer JS crash; the others (Killed / OOM /
 *  LaunchFailed / IntegrityFailure) are infrastructure-level signals
 *  worth distinguishing in the admin-panel inbox. */
export enum RendererReason {
	Crashed = "crashed",
	Killed = "killed",
	OutOfMemory = "oom",
	LaunchFailed = "launch-failed",
	IntegrityFailure = "integrity-failure",
}

/** Strict bounds enforced by `validateCrashPayload`. */
export const CRASH_MESSAGE_MAX_LENGTH = 1024;
export const CRASH_STACK_MAX_BYTES = 32 * 1024;
export const CRASH_RECENT_LOG_MAX_BYTES = 64 * 1024;

export type CrashPayload = {
	readonly kind: CrashKind;
	readonly rendererReason?: RendererReason;
	readonly exitCode?: number;
	readonly message: string;
	readonly stack?: string;
	readonly appId?: string;
	readonly routePath?: string;
	readonly recentLogExcerpt: string;
	readonly clientVersion: string;
	readonly clientPlatform: string;
	readonly capturedAt: number;
	readonly submittedAt?: number;
	readonly requestId: string;
	readonly installationId: string;
	readonly durationSinceBootMs: number;
};

export enum CrashPayloadError {
	MissingKind = "missing-kind",
	InvalidKind = "invalid-kind",
	MissingMessage = "missing-message",
	MessageTooLong = "message-too-long",
	StackTooLong = "stack-too-long",
	MissingRequestId = "missing-request-id",
	MissingClientVersion = "missing-client-version",
	MissingPlatform = "missing-platform",
	MissingInstallationId = "missing-installation-id",
	InvalidExitCode = "invalid-exit-code",
	InvalidDuration = "invalid-duration",
	MalformedShape = "malformed-shape",
}

export type CrashPayloadValidationResult =
	| { readonly ok: true; readonly payload: CrashPayload }
	| {
			readonly ok: false;
			readonly error: CrashPayloadError;
			readonly detail: string;
	  };

/** Brainstorm credential-store key shapes per doc-29 — matches the
 *  same matcher in `feedback-payload.ts`. */
const CREDENTIAL_KEY_PATTERN =
	/\b(?:proxy\.[a-z0-9.-]+(?::\d{1,5})?|noble\.[a-z0-9._-]+|kr:[a-zA-Z0-9._-]+)\b/g;

const POSIX_HOME_PATTERN = /\/(?:Users|home)\/[^/\s]+\//g;
const WINDOWS_HOME_PATTERN = /\b[A-Z]:\\Users\\[^\\\s]+\\/gi;
const EMAIL_IN_TEXT_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export type CrashRedactionOptions = {
	readonly vaultPath: string;
};

/** Strip every secret-shaped token from a `CrashPayload` and return a
 *  fresh payload. Pure — does not mutate the input. */
export function redactCrashPayload(
	payload: CrashPayload,
	options: CrashRedactionOptions,
): CrashPayload {
	const vaultPath = options.vaultPath;

	const message = clampString(
		scrubEmails(redactText(payload.message, vaultPath)),
		CRASH_MESSAGE_MAX_LENGTH,
	);

	let stack: string | undefined;
	if (typeof payload.stack === "string" && payload.stack.length > 0) {
		const redacted = scrubEmails(redactText(payload.stack, vaultPath));
		stack = truncateTailBytes(redacted, CRASH_STACK_MAX_BYTES);
	}

	const recentLogExcerpt = truncateTailBytes(
		scrubEmails(redactText(payload.recentLogExcerpt, vaultPath)),
		CRASH_RECENT_LOG_MAX_BYTES,
	);

	const next: CrashPayload = {
		kind: payload.kind,
		message,
		recentLogExcerpt,
		clientVersion: payload.clientVersion,
		clientPlatform: payload.clientPlatform,
		capturedAt: payload.capturedAt,
		requestId: payload.requestId,
		installationId: payload.installationId,
		durationSinceBootMs: payload.durationSinceBootMs,
		...(payload.rendererReason !== undefined ? { rendererReason: payload.rendererReason } : {}),
		...(payload.exitCode !== undefined ? { exitCode: payload.exitCode } : {}),
		...(stack !== undefined ? { stack } : {}),
		...(payload.appId !== undefined ? { appId: payload.appId } : {}),
		...(payload.routePath !== undefined ? { routePath: payload.routePath } : {}),
		...(payload.submittedAt !== undefined ? { submittedAt: payload.submittedAt } : {}),
	};
	return next;
}

/** Pure path-substitution chain — vault prefix → home prefix → credential
 *  keys. Order matches `feedback-payload.ts` so vault collapse runs before
 *  the home-prefix sweep that would otherwise swallow it. */
function redactText(input: string, vaultPath: string): string {
	let out = input;
	const cleaned = vaultPath.replace(/[/\\]+$/, "");
	if (cleaned.length > 0) {
		out = replaceAll(out, cleaned, "<vault>");
		const homeExpanded = expandHomePrefix(cleaned);
		if (homeExpanded !== null && homeExpanded !== cleaned) {
			out = replaceAll(out, homeExpanded, "<vault>");
		}
		const tildeForm = collapseToTilde(cleaned);
		if (tildeForm !== null && tildeForm !== cleaned) {
			out = replaceAll(out, tildeForm, "<vault>");
		}
	}
	out = out.replace(POSIX_HOME_PATTERN, "<home>/");
	out = out.replace(WINDOWS_HOME_PATTERN, "<home>\\");
	out = out.replace(CREDENTIAL_KEY_PATTERN, "<credential>");
	return out;
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
	if (needle.length === 0) return haystack;
	let out = "";
	let cursor = 0;
	while (cursor <= haystack.length) {
		const found = haystack.indexOf(needle, cursor);
		if (found === -1) {
			out += haystack.slice(cursor);
			break;
		}
		out += haystack.slice(cursor, found);
		out += replacement;
		cursor = found + needle.length;
	}
	return out;
}

function expandHomePrefix(input: string): string | null {
	if (!input.startsWith("~/") && input !== "~") return null;
	const home = readHomeDir();
	if (!home) return null;
	if (input === "~") return home;
	return `${home}${input.slice(1)}`;
}

function collapseToTilde(input: string): string | null {
	const home = readHomeDir();
	if (!home || home.length === 0) return null;
	const normalisedHome = home.replace(/[/\\]+$/, "");
	if (input === normalisedHome) return "~";
	if (input.startsWith(`${normalisedHome}/`)) {
		return `~/${input.slice(normalisedHome.length + 1)}`;
	}
	if (input.startsWith(`${normalisedHome}\\`)) {
		return `~\\${input.slice(normalisedHome.length + 1)}`;
	}
	return null;
}

function readHomeDir(): string {
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env;
	const home = env?.HOME ?? env?.USERPROFILE ?? "";
	return typeof home === "string" ? home : "";
}

function scrubEmails(input: string): string {
	return input.replace(EMAIL_IN_TEXT_PATTERN, "<email>");
}

function clampString(input: string, maxLength: number): string {
	if (input.length <= maxLength) return input;
	return `${input.slice(0, maxLength - 1)}…`;
}

function truncateTailBytes(input: string, maxBytes: number): string {
	const encoded = new TextEncoder().encode(input);
	if (encoded.length <= maxBytes) return input;
	const slice = encoded.slice(encoded.length - maxBytes);
	const decoded = new TextDecoder("utf-8", { fatal: false }).decode(slice);
	return `…${decoded}`;
}

/** Strict input validation. Returns the typed result so the queue + IPC
 *  paths can refuse malformed shapes without bubbling generic errors. */
export function validateCrashPayload(input: unknown): CrashPayloadValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {
			ok: false,
			error: CrashPayloadError.MalformedShape,
			detail: "crash payload must be a plain object",
		};
	}
	const raw = input as Record<string, unknown>;

	if (raw.kind === undefined) {
		return {
			ok: false,
			error: CrashPayloadError.MissingKind,
			detail: "{ kind } is required",
		};
	}
	if (!isCrashKind(raw.kind)) {
		return {
			ok: false,
			error: CrashPayloadError.InvalidKind,
			detail: `unknown kind ${String(raw.kind)}`,
		};
	}

	if (typeof raw.message !== "string") {
		return {
			ok: false,
			error: CrashPayloadError.MissingMessage,
			detail: "{ message } must be a string",
		};
	}
	if (raw.message.length === 0) {
		return {
			ok: false,
			error: CrashPayloadError.MissingMessage,
			detail: "{ message } must be non-empty",
		};
	}
	if (raw.message.length > CRASH_MESSAGE_MAX_LENGTH) {
		return {
			ok: false,
			error: CrashPayloadError.MessageTooLong,
			detail: `{ message } must be ≤ ${CRASH_MESSAGE_MAX_LENGTH} chars`,
		};
	}

	let stack: string | undefined;
	if (raw.stack !== undefined) {
		if (typeof raw.stack !== "string") {
			return {
				ok: false,
				error: CrashPayloadError.MalformedShape,
				detail: "{ stack } must be a string",
			};
		}
		const stackBytes = new TextEncoder().encode(raw.stack).length;
		if (stackBytes > CRASH_STACK_MAX_BYTES) {
			return {
				ok: false,
				error: CrashPayloadError.StackTooLong,
				detail: `{ stack } must be ≤ ${CRASH_STACK_MAX_BYTES} bytes`,
			};
		}
		stack = raw.stack;
	}

	let rendererReason: RendererReason | undefined;
	if (raw.rendererReason !== undefined) {
		if (!isRendererReason(raw.rendererReason)) {
			return {
				ok: false,
				error: CrashPayloadError.MalformedShape,
				detail: `unknown rendererReason ${String(raw.rendererReason)}`,
			};
		}
		rendererReason = raw.rendererReason;
	}

	let exitCode: number | undefined;
	if (raw.exitCode !== undefined) {
		if (typeof raw.exitCode !== "number" || !Number.isFinite(raw.exitCode)) {
			return {
				ok: false,
				error: CrashPayloadError.InvalidExitCode,
				detail: "{ exitCode } must be a finite number",
			};
		}
		exitCode = raw.exitCode;
	}

	let appId: string | undefined;
	if (raw.appId !== undefined) {
		if (typeof raw.appId !== "string" || raw.appId.length === 0) {
			return {
				ok: false,
				error: CrashPayloadError.MalformedShape,
				detail: "{ appId } must be a non-empty string",
			};
		}
		appId = raw.appId;
	}

	let routePath: string | undefined;
	if (raw.routePath !== undefined) {
		if (typeof raw.routePath !== "string") {
			return {
				ok: false,
				error: CrashPayloadError.MalformedShape,
				detail: "{ routePath } must be a string",
			};
		}
		routePath = raw.routePath;
	}

	if (typeof raw.recentLogExcerpt !== "string") {
		return {
			ok: false,
			error: CrashPayloadError.MalformedShape,
			detail: "{ recentLogExcerpt } must be a string",
		};
	}

	if (typeof raw.clientVersion !== "string" || raw.clientVersion.length === 0) {
		return {
			ok: false,
			error: CrashPayloadError.MissingClientVersion,
			detail: "{ clientVersion } is required",
		};
	}
	if (typeof raw.clientPlatform !== "string" || raw.clientPlatform.length === 0) {
		return {
			ok: false,
			error: CrashPayloadError.MissingPlatform,
			detail: "{ clientPlatform } is required",
		};
	}

	if (typeof raw.capturedAt !== "number" || !Number.isFinite(raw.capturedAt)) {
		return {
			ok: false,
			error: CrashPayloadError.MalformedShape,
			detail: "{ capturedAt } must be a finite number",
		};
	}

	let submittedAt: number | undefined;
	if (raw.submittedAt !== undefined) {
		if (typeof raw.submittedAt !== "number" || !Number.isFinite(raw.submittedAt)) {
			return {
				ok: false,
				error: CrashPayloadError.MalformedShape,
				detail: "{ submittedAt } must be a finite number",
			};
		}
		submittedAt = raw.submittedAt;
	}

	if (typeof raw.requestId !== "string" || raw.requestId.length === 0) {
		return {
			ok: false,
			error: CrashPayloadError.MissingRequestId,
			detail: "{ requestId } is required",
		};
	}
	if (typeof raw.installationId !== "string" || raw.installationId.length === 0) {
		return {
			ok: false,
			error: CrashPayloadError.MissingInstallationId,
			detail: "{ installationId } is required",
		};
	}

	if (
		typeof raw.durationSinceBootMs !== "number" ||
		!Number.isFinite(raw.durationSinceBootMs) ||
		raw.durationSinceBootMs < 0
	) {
		return {
			ok: false,
			error: CrashPayloadError.InvalidDuration,
			detail: "{ durationSinceBootMs } must be a non-negative finite number",
		};
	}

	const payload: CrashPayload = {
		kind: raw.kind,
		message: raw.message,
		recentLogExcerpt: raw.recentLogExcerpt,
		clientVersion: raw.clientVersion,
		clientPlatform: raw.clientPlatform,
		capturedAt: raw.capturedAt,
		requestId: raw.requestId,
		installationId: raw.installationId,
		durationSinceBootMs: raw.durationSinceBootMs,
		...(rendererReason !== undefined ? { rendererReason } : {}),
		...(exitCode !== undefined ? { exitCode } : {}),
		...(stack !== undefined ? { stack } : {}),
		...(appId !== undefined ? { appId } : {}),
		...(routePath !== undefined ? { routePath } : {}),
		...(submittedAt !== undefined ? { submittedAt } : {}),
	};
	return { ok: true, payload };
}

function isCrashKind(value: unknown): value is CrashKind {
	return (
		value === CrashKind.UncaughtException ||
		value === CrashKind.UnhandledRejection ||
		value === CrashKind.RendererProcessGone ||
		value === CrashKind.RendererCrashed ||
		value === CrashKind.RendererKilled ||
		value === CrashKind.UnresponsiveRenderer ||
		value === CrashKind.MainProcessGone
	);
}

function isRendererReason(value: unknown): value is RendererReason {
	return (
		value === RendererReason.Crashed ||
		value === RendererReason.Killed ||
		value === RendererReason.OutOfMemory ||
		value === RendererReason.LaunchFailed ||
		value === RendererReason.IntegrityFailure
	);
}

/** Map an Electron `RenderProcessGoneDetails.reason` string to our enum.
 *  Electron currently emits the same strings we use; this indirection
 *  shields us if a future Electron bump renames one. */
export function rendererReasonFromElectron(reason: string): RendererReason {
	switch (reason) {
		case "crashed":
			return RendererReason.Crashed;
		case "killed":
			return RendererReason.Killed;
		case "oom":
		case "out-of-memory":
			return RendererReason.OutOfMemory;
		case "launch-failed":
			return RendererReason.LaunchFailed;
		case "integrity-failure":
			return RendererReason.IntegrityFailure;
		default:
			return RendererReason.Crashed;
	}
}

/** Derive the right `CrashKind` for a `render-process-gone` event from
 *  the renderer's reason. `Crashed` is the noisy-app variant; the others
 *  collapse to `RendererProcessGone` so the kind tally stays meaningful
 *  in the admin-panel inbox. */
export function crashKindFromRendererReason(reason: RendererReason): CrashKind {
	switch (reason) {
		case RendererReason.Crashed:
			return CrashKind.RendererCrashed;
		case RendererReason.Killed:
			return CrashKind.RendererKilled;
		default:
			return CrashKind.RendererProcessGone;
	}
}
