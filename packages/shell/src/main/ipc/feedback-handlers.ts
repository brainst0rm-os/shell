/**
 * Feedback-1 — privileged IPC handlers.
 *
 * Four `ipcMain.handle` channels exposed to the **dashboard renderer
 * only**. App renderers do NOT receive these — `FeedbackService` is
 * never registered with the broker; the only path from any renderer to
 * the service is through the channels here, and the channels are only
 * reachable from the privileged preload (`packages/shell/src/preload/index.ts`).
 *
 *   - `feedback:settings:get`  → `{ enabled, endpoint, installationId }`
 *   - `feedback:settings:set`  → patch the opt-in / endpoint
 *   - `feedback:submit`        → `FeedbackPayload` → `FeedbackSubmitResult`
 *   - `feedback:recent-log`    → last 64 KiB of the redacted ring buffer
 *
 * On submit error the handler re-throws a named `FeedbackError` so the
 * renderer can pattern-match on `error.name === "FeedbackError"` + read
 * `error.kind`. Electron's IPC layer preserves the `name` field across
 * the boundary; `kind` is copied onto `error.message` via the
 * `FeedbackError` constructor so the renderer can still extract it.
 */

import { ipcMain } from "electron";
import type { CrashPayload } from "../feedback/crash-payload";
import type { CrashQueue } from "../feedback/crash-queue";
import type {
	CrashReporterService,
	CrashSubmissionResult,
} from "../feedback/crash-reporter-service";
import { type FeedbackPayload, redactPayload } from "../feedback/feedback-payload";
import {
	FeedbackError,
	FeedbackErrorKind,
	type FeedbackService,
	type FeedbackSubmitResult,
} from "../feedback/feedback-service";
import type { FeedbackAppSettings } from "../feedback/feedback-settings-store";
import type { RecentLogBuffer } from "../feedback/recent-log-buffer";
import { getActiveVaultSession } from "../vault/session";

export const FEEDBACK_SETTINGS_GET_CHANNEL = "feedback:settings:get";
export const FEEDBACK_SETTINGS_SET_CHANNEL = "feedback:settings:set";
export const FEEDBACK_SUBMIT_CHANNEL = "feedback:submit";
export const FEEDBACK_RECENT_LOG_CHANNEL = "feedback:recent-log";
export const FEEDBACK_CRASH_PENDING_COUNT_CHANNEL = "feedback:crash:pending-count";
export const FEEDBACK_CRASH_LIST_CHANNEL = "feedback:crash:list";
export const FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL = "feedback:crash:submit-now";
export const FEEDBACK_CRASH_CLEAR_CHANNEL = "feedback:crash:clear";

export type FeedbackSettingsPatchRequest = {
	readonly enabled?: boolean;
	readonly endpoint?: string | null;
	readonly crashReportingEnabled?: boolean;
};

export type FeedbackHandlersOptions = {
	readonly service: FeedbackService;
	readonly recentLogBuffer: RecentLogBuffer;
	/** Optional — when omitted (e.g. tests covering Feedback-1 only) the
	 *  crash-reporter channels stay unregistered. Production always wires
	 *  these per `main/index.ts`. */
	readonly crashReporterService?: CrashReporterService;
	readonly crashQueue?: CrashQueue;
};

export type CrashPendingSummary = {
	readonly count: number;
	readonly localCount: number;
	readonly lastCapturedAt: number | null;
	readonly lastSubmitAttemptMs: number | null;
};

export function registerFeedbackHandlers(options: FeedbackHandlersOptions): void {
	ipcMain.handle(FEEDBACK_SETTINGS_GET_CHANNEL, async (): Promise<FeedbackAppSettings> => {
		return await options.service.getSettings();
	});

	ipcMain.handle(
		FEEDBACK_SETTINGS_SET_CHANNEL,
		async (_event, raw: unknown): Promise<FeedbackAppSettings> => {
			const patch = normaliseSettingsPatch(raw);
			let current = await options.service.getSettings();
			if (patch.enabled !== undefined && patch.enabled !== current.enabled) {
				current = await options.service.setEnabled(patch.enabled);
			}
			if (patch.endpoint !== undefined && patch.endpoint !== current.endpoint) {
				current = await options.service.setEndpoint(patch.endpoint);
			}
			if (
				patch.crashReportingEnabled !== undefined &&
				patch.crashReportingEnabled !== current.crashReportingEnabled
			) {
				current = await options.service.setCrashReportingEnabled(patch.crashReportingEnabled);
			}
			return current;
		},
	);

	ipcMain.handle(
		FEEDBACK_SUBMIT_CHANNEL,
		async (_event, raw: unknown): Promise<FeedbackSubmitResult> => {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
				throw new FeedbackError(
					FeedbackErrorKind.InvalidPayload,
					"feedback payload must be a plain object",
				);
			}
			return await options.service.submit(raw as FeedbackPayload);
		},
	);

	if (options.crashReporterService && options.crashQueue) {
		const crashService = options.crashReporterService;
		const crashQueue = options.crashQueue;

		ipcMain.handle(FEEDBACK_CRASH_PENDING_COUNT_CHANNEL, async (): Promise<CrashPendingSummary> => {
			const [count, settings] = await Promise.all([crashQueue.count(), options.service.getSettings()]);
			const counter = crashService.getLocalCounter();
			return {
				count,
				localCount: counter.count,
				lastCapturedAt: counter.lastCapturedAt,
				lastSubmitAttemptMs: settings.lastCrashSubmitAttemptMs,
			};
		});

		ipcMain.handle(FEEDBACK_CRASH_LIST_CHANNEL, async (): Promise<readonly CrashPayload[]> => {
			return await crashQueue.pending();
		});

		ipcMain.handle(FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL, async (): Promise<CrashSubmissionResult> => {
			return await crashService.submitPending();
		});

		ipcMain.handle(FEEDBACK_CRASH_CLEAR_CHANNEL, async (): Promise<number> => {
			const removed = await crashQueue.clearAll();
			crashService.resetLocalCounter();
			return removed;
		});
	}

	ipcMain.handle(FEEDBACK_RECENT_LOG_CHANNEL, async (): Promise<string> => {
		const log = options.recentLogBuffer.read();
		const vaultPath = getActiveVaultSession()?.vaultPath ?? "";
		// Hand the buffer through `redactPayload`'s text redactor (via a
		// scratch payload) so the preview the dialog shows matches what
		// `submit()` would send byte-for-byte. The user sees exactly what
		// gets shipped — no surprise leaks.
		const scratch: FeedbackPayload = {
			kind: "bug" as FeedbackPayload["kind"],
			title: "preview",
			body: "_",
			sensitivity: "anonymous" as FeedbackPayload["sensitivity"],
			includeRecentLog: true,
			recentLogExcerpt: log,
			clientVersion: "preview",
			clientPlatform: "preview",
			submittedAt: 0,
			requestId: "preview",
		};
		const redacted = redactPayload(scratch, { vaultPath });
		return redacted.recentLogExcerpt ?? "";
	});
}

/** Drop the handlers on dashboard close so re-registration is clean. */
export function disposeFeedbackHandlers(): void {
	ipcMain.removeHandler(FEEDBACK_SETTINGS_GET_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_SETTINGS_SET_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_SUBMIT_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_RECENT_LOG_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_CRASH_PENDING_COUNT_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_CRASH_LIST_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_CRASH_SUBMIT_NOW_CHANNEL);
	ipcMain.removeHandler(FEEDBACK_CRASH_CLEAR_CHANNEL);
}

/** Pure validator for the patch shape — returned to the test suite for
 *  coverage. Rejects non-objects + non-boolean enabled + non-string
 *  endpoint; explicitly allows `endpoint: null` (clears the field). */
export function normaliseSettingsPatch(input: unknown): FeedbackSettingsPatchRequest {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const raw = input as Record<string, unknown>;
	const out: { enabled?: boolean; endpoint?: string | null; crashReportingEnabled?: boolean } = {};
	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") {
			throw makeInvalidError("{ enabled } must be a boolean");
		}
		out.enabled = raw.enabled;
	}
	if (raw.endpoint !== undefined) {
		if (raw.endpoint === null) {
			out.endpoint = null;
		} else if (typeof raw.endpoint !== "string") {
			throw makeInvalidError("{ endpoint } must be a string or null");
		} else {
			const trimmed = raw.endpoint.trim();
			if (trimmed.length === 0) {
				out.endpoint = null;
			} else if (!/^https?:\/\//i.test(trimmed)) {
				throw makeInvalidError("{ endpoint } must be an http(s) URL");
			} else {
				out.endpoint = trimmed;
			}
		}
	}
	if (raw.crashReportingEnabled !== undefined) {
		if (typeof raw.crashReportingEnabled !== "boolean") {
			throw makeInvalidError("{ crashReportingEnabled } must be a boolean");
		}
		out.crashReportingEnabled = raw.crashReportingEnabled;
	}
	return out;
}

function makeInvalidError(detail: string): Error {
	const err = new Error(detail);
	err.name = "Invalid";
	return err;
}
