/**
 * Feedback-1 — privileged IPC handler tests.
 *
 * The handlers proxy through `FeedbackService` (covered separately under
 * `feedback/feedback-service.test.ts`); here we assert the
 * registration shape + the patch normaliser + the recent-log preview
 * redaction (the handler-only surface).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
	ipcMain: {
		handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
			handlers.set(channel, listener);
		}),
		removeHandler: vi.fn((channel: string) => {
			handlers.delete(channel);
		}),
	},
}));

vi.mock("../vault/session", () => ({
	getActiveVaultSession: vi.fn(() => ({ vaultPath: "/Users/alice/Vault" })),
}));

import { LogLevel } from "../diagnostics/error-log";
import { CrashKind } from "../feedback/crash-payload";
import type { CrashQueue } from "../feedback/crash-queue";
import type { CrashReporterService } from "../feedback/crash-reporter-service";
import {
	FeedbackError,
	FeedbackErrorKind,
	type FeedbackService,
} from "../feedback/feedback-service";
import type { FeedbackAppSettings } from "../feedback/feedback-settings-store";
import { RecentLogBuffer } from "../feedback/recent-log-buffer";
import {
	FEEDBACK_CRASH_CLEAR_CHANNEL,
	FEEDBACK_CRASH_LIST_CHANNEL,
	FEEDBACK_CRASH_PENDING_COUNT_CHANNEL,
	FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL,
	FEEDBACK_RECENT_LOG_CHANNEL,
	FEEDBACK_SETTINGS_GET_CHANNEL,
	FEEDBACK_SETTINGS_SET_CHANNEL,
	FEEDBACK_SUBMIT_CHANNEL,
	disposeFeedbackHandlers,
	normaliseSettingsPatch,
	registerFeedbackHandlers,
} from "./feedback-handlers";

function makeService(initial: FeedbackAppSettings) {
	let settings = { ...initial };
	const service = {
		getSettings: vi.fn(async () => settings),
		setEnabled: vi.fn(async (enabled: boolean) => {
			settings = { ...settings, enabled };
			return settings;
		}),
		setEndpoint: vi.fn(async (endpoint: string | null) => {
			settings = { ...settings, endpoint };
			return settings;
		}),
		setCrashReportingEnabled: vi.fn(async (crashReportingEnabled: boolean) => {
			settings = { ...settings, crashReportingEnabled };
			return settings;
		}),
		submit: vi.fn(async () => ({
			ok: true as const,
			requestId: "stub",
			serverReceivedAt: 1_700_000_000_000,
		})),
	};
	return service as unknown as FeedbackService & typeof service;
}

function makeCrashStubs(opts: { pendingCount?: number } = {}) {
	const queue = {
		count: vi.fn(async () => opts.pendingCount ?? 0),
		pending: vi.fn(async () => []),
		enqueue: vi.fn(async () => undefined),
		remove: vi.fn(async () => undefined),
		clearAll: vi.fn(async () => opts.pendingCount ?? 0),
		prune: vi.fn(async () => 0),
	} as unknown as CrashQueue;
	const service = {
		submitPending: vi.fn(async () => ({ submitted: 1, failed: 0, dropped: 0 })),
		capture: vi.fn(async () => undefined),
		getLocalCounter: vi.fn(() => ({ count: 0, lastCapturedAt: null })),
		resetLocalCounter: vi.fn(),
	} as unknown as CrashReporterService;
	return { queue, service };
}

const defaultSettings: FeedbackAppSettings = {
	enabled: false,
	endpoint: null,
	installationId: "id",
	crashReportingEnabled: false,
	lastCrashSubmitAttemptMs: null,
};

describe("registerFeedbackHandlers — channel wiring", () => {
	beforeEach(() => {
		handlers.clear();
	});
	afterEach(() => {
		disposeFeedbackHandlers();
		handlers.clear();
	});

	it("registers all four channels", () => {
		const service = makeService(defaultSettings);
		const buffer = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		expect(handlers.has(FEEDBACK_SETTINGS_GET_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_SETTINGS_SET_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_SUBMIT_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_RECENT_LOG_CHANNEL)).toBe(true);
	});

	it("get returns the service's settings", async () => {
		const service = makeService({
			...defaultSettings,
			enabled: true,
			endpoint: "https://admin.example/api/feedback",
			installationId: "abc",
		});
		const buffer = new RecentLogBuffer();
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_SETTINGS_GET_CHANNEL);
		if (!handler) throw new Error("settings:get handler not registered");
		const result = await handler({});
		expect(result).toMatchObject({
			enabled: true,
			endpoint: "https://admin.example/api/feedback",
			installationId: "abc",
		});
	});

	it("set proxies enabled + endpoint patches to the service in one call", async () => {
		const service = makeService({ ...defaultSettings, installationId: "abc" });
		const buffer = new RecentLogBuffer();
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_SETTINGS_SET_CHANNEL);
		if (!handler) throw new Error("settings:set handler not registered");
		await handler({}, { enabled: true, endpoint: "https://admin.example/api/feedback" });
		expect(service.setEnabled).toHaveBeenCalledWith(true);
		expect(service.setEndpoint).toHaveBeenCalledWith("https://admin.example/api/feedback");
	});

	it("set rejects a non-string endpoint", async () => {
		const service = makeService({ ...defaultSettings, installationId: "abc" });
		const buffer = new RecentLogBuffer();
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_SETTINGS_SET_CHANNEL);
		if (!handler) throw new Error("settings:set handler not registered");
		await expect(handler({}, { endpoint: 7 })).rejects.toMatchObject({
			name: "Invalid",
		});
	});

	it("submit re-throws FeedbackError when the service does", async () => {
		const service = makeService({ ...defaultSettings, installationId: "abc" });
		service.submit.mockImplementationOnce(async () => {
			throw new FeedbackError(FeedbackErrorKind.OptInRequired, "off");
		});
		const buffer = new RecentLogBuffer();
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_SUBMIT_CHANNEL);
		if (!handler) throw new Error("submit handler not registered");
		await expect(
			handler({}, { kind: "bug", title: "x", body: "y", sensitivity: "anonymous" }),
		).rejects.toMatchObject({
			name: "FeedbackError",
			kind: FeedbackErrorKind.OptInRequired,
		});
	});

	it("submit refuses a non-object payload before reaching the service", async () => {
		const service = makeService({
			...defaultSettings,
			enabled: true,
			endpoint: "https://admin.example/api/feedback",
			installationId: "abc",
		});
		const buffer = new RecentLogBuffer();
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_SUBMIT_CHANNEL);
		if (!handler) throw new Error("submit handler not registered");
		await expect(handler({}, "not-an-object")).rejects.toMatchObject({
			name: "FeedbackError",
			kind: FeedbackErrorKind.InvalidPayload,
		});
		expect(service.submit).not.toHaveBeenCalled();
	});

	it("recent-log returns the redacted buffer contents", async () => {
		const service = makeService({
			...defaultSettings,
			enabled: true,
			endpoint: "https://admin.example/api/feedback",
			installationId: "abc",
		});
		const buffer = new RecentLogBuffer({ now: () => 1_700_000_000_000 });
		buffer.append({
			level: LogLevel.Error,
			scope: "app:notes",
			message: "open /Users/alice/Vault/Notes/x.md proxy.h:1080 ops@vendor.example",
		});
		registerFeedbackHandlers({ service, recentLogBuffer: buffer });
		const handler = handlers.get(FEEDBACK_RECENT_LOG_CHANNEL);
		if (!handler) throw new Error("recent-log handler not registered");
		const result = (await handler({})) as string;
		expect(result).toContain("<vault>/Notes/x.md");
		expect(result).toContain("<credential>");
		expect(result).toContain("<email>");
		expect(result).not.toContain("/Users/alice/Vault");
	});
});

describe("crash-reporter channels (Feedback-2)", () => {
	beforeEach(() => {
		handlers.clear();
	});
	afterEach(() => {
		disposeFeedbackHandlers();
		handlers.clear();
	});

	it("registers crash-reporter channels when service + queue supplied", () => {
		const service = makeService(defaultSettings);
		const crash = makeCrashStubs();
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		expect(handlers.has(FEEDBACK_CRASH_PENDING_COUNT_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_CRASH_LIST_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL)).toBe(true);
		expect(handlers.has(FEEDBACK_CRASH_CLEAR_CHANNEL)).toBe(true);
	});

	it("does NOT register crash channels when crash service is absent", () => {
		const service = makeService(defaultSettings);
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
		});
		expect(handlers.has(FEEDBACK_CRASH_PENDING_COUNT_CHANNEL)).toBe(false);
		expect(handlers.has(FEEDBACK_CRASH_LIST_CHANNEL)).toBe(false);
		expect(handlers.has(FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL)).toBe(false);
		expect(handlers.has(FEEDBACK_CRASH_CLEAR_CHANNEL)).toBe(false);
	});

	it("pending-count returns count + local counter + last attempt", async () => {
		const service = makeService({
			...defaultSettings,
			crashReportingEnabled: true,
			lastCrashSubmitAttemptMs: 1_700_000_000_000,
		});
		const crash = makeCrashStubs({ pendingCount: 3 });
		(crash.service.getLocalCounter as ReturnType<typeof vi.fn>).mockReturnValue({
			count: 5,
			lastCapturedAt: 1_700_000_001_000,
		});
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		const handler = handlers.get(FEEDBACK_CRASH_PENDING_COUNT_CHANNEL);
		if (!handler) throw new Error("pending-count not registered");
		const result = await handler({});
		expect(result).toEqual({
			count: 3,
			localCount: 5,
			lastCapturedAt: 1_700_000_001_000,
			lastSubmitAttemptMs: 1_700_000_000_000,
		});
	});

	it("list returns the queue's pending payloads", async () => {
		const service = makeService(defaultSettings);
		const crash = makeCrashStubs();
		const payload = {
			kind: CrashKind.UncaughtException,
			message: "boom",
			recentLogExcerpt: "",
			clientVersion: "v",
			clientPlatform: "darwin",
			capturedAt: 1,
			requestId: "r",
			installationId: "i",
			durationSinceBootMs: 0,
		};
		(crash.queue.pending as ReturnType<typeof vi.fn>).mockResolvedValue([payload]);
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		const handler = handlers.get(FEEDBACK_CRASH_LIST_CHANNEL);
		if (!handler) throw new Error("list not registered");
		const result = (await handler({})) as readonly (typeof payload)[];
		expect(result).toHaveLength(1);
		expect(result[0]?.requestId).toBe("r");
	});

	it("submit-now proxies to crashReporterService.submitPending", async () => {
		const service = makeService(defaultSettings);
		const crash = makeCrashStubs();
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		const handler = handlers.get(FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL);
		if (!handler) throw new Error("submit-now not registered");
		const result = (await handler({})) as { submitted: number; failed: number; dropped: number };
		expect(result).toEqual({ submitted: 1, failed: 0, dropped: 0 });
		expect(crash.service.submitPending).toHaveBeenCalled();
	});

	it("clear drops everything and resets the local counter", async () => {
		const service = makeService(defaultSettings);
		const crash = makeCrashStubs({ pendingCount: 2 });
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		const handler = handlers.get(FEEDBACK_CRASH_CLEAR_CHANNEL);
		if (!handler) throw new Error("clear not registered");
		const result = (await handler({})) as number;
		expect(result).toBe(2);
		expect(crash.service.resetLocalCounter).toHaveBeenCalled();
	});

	it("set flips crashReportingEnabled through the service", async () => {
		const service = makeService({ ...defaultSettings, installationId: "abc" });
		const crash = makeCrashStubs();
		registerFeedbackHandlers({
			service,
			recentLogBuffer: new RecentLogBuffer(),
			crashReporterService: crash.service,
			crashQueue: crash.queue,
		});
		const handler = handlers.get(FEEDBACK_SETTINGS_SET_CHANNEL);
		if (!handler) throw new Error("settings:set handler not registered");
		await handler({}, { crashReportingEnabled: true });
		expect(service.setCrashReportingEnabled).toHaveBeenCalledWith(true);
	});
});

describe("normaliseSettingsPatch", () => {
	it("returns empty object on non-object input", () => {
		expect(normaliseSettingsPatch(null)).toEqual({});
		expect(normaliseSettingsPatch([])).toEqual({});
	});

	it("rejects non-boolean enabled", () => {
		expect(() => normaliseSettingsPatch({ enabled: "true" })).toThrow();
	});

	it("rejects non-http endpoint", () => {
		expect(() => normaliseSettingsPatch({ endpoint: "ftp://x/y" })).toThrow();
	});

	it("treats empty-string endpoint as null", () => {
		expect(normaliseSettingsPatch({ endpoint: "" })).toEqual({ endpoint: null });
		expect(normaliseSettingsPatch({ endpoint: "   " })).toEqual({ endpoint: null });
	});

	it("accepts null endpoint", () => {
		expect(normaliseSettingsPatch({ endpoint: null })).toEqual({ endpoint: null });
	});

	it("accepts http:// and https:// endpoints", () => {
		expect(normaliseSettingsPatch({ endpoint: "http://localhost:8080/api/feedback" })).toEqual({
			endpoint: "http://localhost:8080/api/feedback",
		});
		expect(normaliseSettingsPatch({ endpoint: "https://admin.example/api/feedback" })).toEqual({
			endpoint: "https://admin.example/api/feedback",
		});
	});

	it("accepts a partial patch — enabled only", () => {
		expect(normaliseSettingsPatch({ enabled: true })).toEqual({ enabled: true });
	});

	it("rejects non-string endpoint shapes", () => {
		expect(() => normaliseSettingsPatch({ endpoint: 7 })).toThrow();
	});

	it("rejects non-boolean crashReportingEnabled", () => {
		expect(() => normaliseSettingsPatch({ crashReportingEnabled: "true" })).toThrow();
	});

	it("accepts crashReportingEnabled boolean", () => {
		expect(normaliseSettingsPatch({ crashReportingEnabled: true })).toEqual({
			crashReportingEnabled: true,
		});
		expect(normaliseSettingsPatch({ crashReportingEnabled: false })).toEqual({
			crashReportingEnabled: false,
		});
	});
});
