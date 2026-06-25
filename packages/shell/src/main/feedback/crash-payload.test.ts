/**
 * Feedback-2 — crash-payload keystone tests.
 *
 * Validation matrix + redactor table per the iteration spec. The
 * redactor table mirrors `feedback-payload.test.ts` because the two
 * surfaces must redact identically.
 */

import { describe, expect, it } from "vitest";
import {
	CRASH_MESSAGE_MAX_LENGTH,
	CRASH_RECENT_LOG_MAX_BYTES,
	CRASH_STACK_MAX_BYTES,
	CrashKind,
	type CrashPayload,
	CrashPayloadError,
	RendererReason,
	crashKindFromRendererReason,
	redactCrashPayload,
	rendererReasonFromElectron,
	validateCrashPayload,
} from "./crash-payload";

function basePayload(overrides: Partial<CrashPayload> = {}): CrashPayload {
	return {
		kind: CrashKind.UncaughtException,
		message: "boom",
		recentLogExcerpt: "",
		clientVersion: "test-build",
		clientPlatform: "darwin",
		capturedAt: 1_700_000_000_000,
		requestId: "01HXXXXXXXXXXXXXXXXXXXXXXX",
		installationId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
		durationSinceBootMs: 12_345,
		...overrides,
	};
}

describe("validateCrashPayload — happy path", () => {
	it("accepts a minimal payload", () => {
		const result = validateCrashPayload(basePayload());
		expect(result.ok).toBe(true);
	});

	it("accepts a fully-populated payload", () => {
		const payload = basePayload({
			rendererReason: RendererReason.OutOfMemory,
			exitCode: 9,
			stack: "Error: x\n    at /Users/alice/Vault/index.js:1:1",
			appId: "notes",
			routePath: "/n/123",
			recentLogExcerpt: "log",
			submittedAt: 1_700_000_001_000,
		});
		const result = validateCrashPayload(payload);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.payload.rendererReason).toBe(RendererReason.OutOfMemory);
			expect(result.payload.exitCode).toBe(9);
			expect(result.payload.appId).toBe("notes");
		}
	});
});

describe("validateCrashPayload — error variants", () => {
	it("MalformedShape on non-object", () => {
		const result = validateCrashPayload("not-an-object");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MalformedShape);
	});

	it("MissingKind on absent kind", () => {
		const { kind: _drop, ...rest } = basePayload();
		const result = validateCrashPayload(rest);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingKind);
	});

	it("InvalidKind on unknown kind", () => {
		const result = validateCrashPayload({ ...basePayload(), kind: "nope" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.InvalidKind);
	});

	it("MissingMessage on non-string message", () => {
		const result = validateCrashPayload({ ...basePayload(), message: 7 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingMessage);
	});

	it("MissingMessage on empty message", () => {
		const result = validateCrashPayload({ ...basePayload(), message: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingMessage);
	});

	it("MessageTooLong above the cap", () => {
		const result = validateCrashPayload({
			...basePayload(),
			message: "x".repeat(CRASH_MESSAGE_MAX_LENGTH + 1),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MessageTooLong);
	});

	it("StackTooLong above the cap", () => {
		const result = validateCrashPayload({
			...basePayload(),
			stack: "x".repeat(CRASH_STACK_MAX_BYTES + 1),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.StackTooLong);
	});

	it("InvalidExitCode on non-numeric exit", () => {
		const result = validateCrashPayload({ ...basePayload(), exitCode: "9" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.InvalidExitCode);
	});

	it("MissingRequestId on empty requestId", () => {
		const result = validateCrashPayload({ ...basePayload(), requestId: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingRequestId);
	});

	it("MissingClientVersion on empty version", () => {
		const result = validateCrashPayload({ ...basePayload(), clientVersion: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingClientVersion);
	});

	it("MissingPlatform on empty platform", () => {
		const result = validateCrashPayload({ ...basePayload(), clientPlatform: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingPlatform);
	});

	it("MissingInstallationId on absent", () => {
		const result = validateCrashPayload({ ...basePayload(), installationId: "" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MissingInstallationId);
	});

	it("InvalidDuration on negative duration", () => {
		const result = validateCrashPayload({ ...basePayload(), durationSinceBootMs: -1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.InvalidDuration);
	});

	it("MalformedShape on unknown rendererReason", () => {
		const result = validateCrashPayload({
			...basePayload(),
			rendererReason: "not-a-reason",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MalformedShape);
	});

	it("MalformedShape on numeric capturedAt missing", () => {
		const result = validateCrashPayload({ ...basePayload(), capturedAt: "nope" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe(CrashPayloadError.MalformedShape);
	});
});

describe("redactCrashPayload — substitutions", () => {
	const VAULT = "/Users/alice/Vault";

	it("collapses the vault path to <vault>", () => {
		const payload = basePayload({
			message: "open /Users/alice/Vault/Notes/x.md failed",
			recentLogExcerpt: "/Users/alice/Vault/index.json missing",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message).toContain("<vault>/Notes/x.md");
		expect(out.recentLogExcerpt).toContain("<vault>/index.json");
		expect(out.message).not.toContain("/Users/alice/Vault");
	});

	it("redacts an unrelated POSIX home prefix to <home>/", () => {
		const payload = basePayload({
			message: "see /Users/bob/Downloads/error.log",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message).toContain("<home>/Downloads/error.log");
		expect(out.message).not.toContain("/Users/bob");
	});

	it("redacts Windows home prefix to <home>\\", () => {
		const payload = basePayload({
			message: "see C:\\Users\\carol\\AppData\\bad",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message).toContain("<home>\\AppData\\bad");
		expect(out.message).not.toContain("carol");
	});

	it("collapses credential-store keys to <credential>", () => {
		const payload = basePayload({
			message: "proxy.h.example:1080 lookup failed",
			recentLogExcerpt: "noble.argon2 noble.x kr:proxy-pass",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message).toContain("<credential> lookup failed");
		expect(out.recentLogExcerpt).toContain("<credential>");
		expect(out.recentLogExcerpt).not.toContain("noble.x");
	});

	it("scrubs email-shaped tokens", () => {
		const payload = basePayload({
			message: "user ops@vendor.example reported it",
			recentLogExcerpt: "see admin@example.com",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message).toContain("<email>");
		expect(out.recentLogExcerpt).toContain("<email>");
		expect(out.message).not.toContain("ops@vendor.example");
		expect(out.recentLogExcerpt).not.toContain("admin@example.com");
	});

	it("rebuilds the stack trace with path redaction in place", () => {
		const payload = basePayload({
			stack: "Error: x\n    at fn (/Users/alice/Vault/index.js:10:5)\n    at /Users/bob/x.js:1:1",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.stack).toContain("<vault>/index.js");
		expect(out.stack).toContain("<home>/x.js");
		expect(out.stack).not.toContain("/Users/alice");
		expect(out.stack).not.toContain("/Users/bob");
	});

	it("truncates message to the configured cap", () => {
		const payload = basePayload({
			message: "x".repeat(CRASH_MESSAGE_MAX_LENGTH * 2),
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.message.length).toBeLessThanOrEqual(CRASH_MESSAGE_MAX_LENGTH);
	});

	it("truncates recentLogExcerpt to last 64 KiB", () => {
		const payload = basePayload({
			recentLogExcerpt: "y".repeat(CRASH_RECENT_LOG_MAX_BYTES * 2),
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		const byteLength = new TextEncoder().encode(out.recentLogExcerpt).length;
		expect(byteLength).toBeLessThanOrEqual(CRASH_RECENT_LOG_MAX_BYTES + 4);
	});

	it("truncates stack to 32 KiB", () => {
		const big = "z".repeat(CRASH_STACK_MAX_BYTES * 2);
		const payload = basePayload({ stack: big });
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.stack).toBeDefined();
		const bytes = new TextEncoder().encode(out.stack ?? "").length;
		expect(bytes).toBeLessThanOrEqual(CRASH_STACK_MAX_BYTES + 4);
	});

	it("does not mutate the input payload", () => {
		const payload = basePayload({
			message: "/Users/alice/Vault/x",
			stack: "/Users/alice/Vault/y",
			recentLogExcerpt: "/Users/alice/Vault/z",
		});
		const snapshot = JSON.stringify(payload);
		redactCrashPayload(payload, { vaultPath: VAULT });
		expect(JSON.stringify(payload)).toBe(snapshot);
	});

	it("preserves enum-typed metadata across the redactor", () => {
		const payload = basePayload({
			kind: CrashKind.RendererCrashed,
			rendererReason: RendererReason.OutOfMemory,
			exitCode: 137,
			appId: "graph",
			routePath: "/g/abc",
		});
		const out = redactCrashPayload(payload, { vaultPath: VAULT });
		expect(out.kind).toBe(CrashKind.RendererCrashed);
		expect(out.rendererReason).toBe(RendererReason.OutOfMemory);
		expect(out.exitCode).toBe(137);
		expect(out.appId).toBe("graph");
		expect(out.routePath).toBe("/g/abc");
	});
});

describe("rendererReasonFromElectron + crashKindFromRendererReason", () => {
	it("maps Electron strings to enum reasons", () => {
		expect(rendererReasonFromElectron("crashed")).toBe(RendererReason.Crashed);
		expect(rendererReasonFromElectron("killed")).toBe(RendererReason.Killed);
		expect(rendererReasonFromElectron("oom")).toBe(RendererReason.OutOfMemory);
		expect(rendererReasonFromElectron("out-of-memory")).toBe(RendererReason.OutOfMemory);
		expect(rendererReasonFromElectron("launch-failed")).toBe(RendererReason.LaunchFailed);
		expect(rendererReasonFromElectron("integrity-failure")).toBe(RendererReason.IntegrityFailure);
		expect(rendererReasonFromElectron("xyz")).toBe(RendererReason.Crashed);
	});

	it("derives the right CrashKind from a renderer reason", () => {
		expect(crashKindFromRendererReason(RendererReason.Crashed)).toBe(CrashKind.RendererCrashed);
		expect(crashKindFromRendererReason(RendererReason.Killed)).toBe(CrashKind.RendererKilled);
		expect(crashKindFromRendererReason(RendererReason.OutOfMemory)).toBe(
			CrashKind.RendererProcessGone,
		);
		expect(crashKindFromRendererReason(RendererReason.LaunchFailed)).toBe(
			CrashKind.RendererProcessGone,
		);
	});
});
