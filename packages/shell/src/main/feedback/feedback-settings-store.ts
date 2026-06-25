/**
 * Feedback-1 — app-level opt-in store.
 *
 * Persists the user's decision to enable feedback submission + the
 * admin-panel endpoint + a stable per-install correlation id under
 * `<userData>/feedback-settings.json`. **App-level, not vault-level**:
 * feedback is about the app, not the user's content (a single Brainstorm
 * install reports against itself, regardless of which vault is open at
 * submission time). Lifetime is "until the user uninstalls".
 *
 * The `installationId` is a stable random ULID minted on first read.
 * It is NOT a hash of anything identifying — it's pure entropy used so
 * staff can correlate multiple reports from the same install
 * server-side without any user-identifying material crossing the wire.
 * No PII, no machine fingerprinting, no telemetry — the id rotates only
 * if the user deletes `<userData>/feedback-settings.json` by hand.
 *
 * Pure file IO + JSON-parse. The async API matches `properties-store` /
 * `vault-network-settings-store`; the load races dedup through an
 * in-flight `Promise` so concurrent reads from IPC handlers don't issue
 * parallel `fs.readFile` calls.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { newRequestId } from "./feedback-payload";

/** On-disk shape persisted to `<userData>/feedback-settings.json`. */
export type FeedbackAppSettings = {
	/** Opt-in toggle per doc-48 §Posture rules ("Opt-in by default"). */
	readonly enabled: boolean;
	/** Admin-panel inbox URL. `null` means "not configured" — `submit`
	 *  fails fast with `EndpointNotConfigured` rather than attempting to
	 *  POST to a guessed endpoint. */
	readonly endpoint: string | null;
	/** Stable per-install correlation id. Pure entropy; not derived from
	 *  any machine-identifying material. Minted on first read; never
	 *  rotated except by manual file deletion. */
	readonly installationId: string;
	/** Feedback-2 — opt-in for the crash reporter (Settings → Privacy →
	 *  "Send anonymized crash reports"). Default false per OQ-144 / doc-38
	 *  §Crash reporter row. When false, captured crashes record only a
	 *  light counter locally; full payloads enqueue only when this is on. */
	readonly crashReportingEnabled: boolean;
	/** Feedback-2 — wall-clock of the most recent submitPending attempt
	 *  (regardless of outcome). Surfaced in the Privacy UI so users see
	 *  whether the queue is being drained. `null` until first attempt. */
	readonly lastCrashSubmitAttemptMs: number | null;
};

export type FeedbackSettingsPatch = {
	readonly enabled?: boolean;
	readonly endpoint?: string | null;
	readonly crashReportingEnabled?: boolean;
	readonly lastCrashSubmitAttemptMs?: number | null;
};

const SETTINGS_FILE_NAME = "feedback-settings.json";

/** Defaults for a brand-new install. Opt-in off; endpoint null until
 *  the build-time wiring or the user fills it in. */
export function makeDefaultSettings(now: number = Date.now(), random: () => number = Math.random) {
	return {
		enabled: false,
		endpoint: null,
		installationId: newRequestId(now, random),
		crashReportingEnabled: false,
		lastCrashSubmitAttemptMs: null,
	} satisfies FeedbackAppSettings;
}

export type FeedbackSettingsStoreOptions = {
	/** Absolute path to the JSON file. Production wires
	 *  `<app.getPath('userData')>/feedback-settings.json`; tests inject a
	 *  tmp file. */
	readonly path: string;
	/** Optional fallback endpoint baked at build time (env var). When the
	 *  on-disk endpoint is null AND a build-time default is supplied,
	 *  `load()` records the default into the file so a subsequent
	 *  `submit` doesn't fail. Pass `null` (or omit) for tests. */
	readonly buildTimeDefaultEndpoint?: string | null;
	readonly now?: () => number;
	readonly random?: () => number;
};

export class FeedbackSettingsStore {
	private cache: FeedbackAppSettings | null = null;
	private loading: Promise<FeedbackAppSettings> | null = null;
	private readonly path: string;
	private readonly buildTimeDefaultEndpoint: string | null;
	private readonly now: () => number;
	private readonly random: () => number;

	constructor(options: FeedbackSettingsStoreOptions) {
		this.path = options.path;
		this.buildTimeDefaultEndpoint = options.buildTimeDefaultEndpoint ?? null;
		this.now = options.now ?? Date.now;
		this.random = options.random ?? Math.random;
	}

	get cached(): FeedbackAppSettings | null {
		return this.cache;
	}

	async load(): Promise<FeedbackAppSettings> {
		if (this.cache) return this.cache;
		if (this.loading) return await this.loading;
		this.loading = (async () => {
			const settings = await this.readFromDisk();
			this.cache = settings;
			this.loading = null;
			return settings;
		})();
		return await this.loading;
	}

	async patch(input: FeedbackSettingsPatch): Promise<FeedbackAppSettings> {
		const current = await this.load();
		const nextEndpoint = input.endpoint === undefined ? current.endpoint : input.endpoint;
		const next: FeedbackAppSettings = {
			enabled: input.enabled ?? current.enabled,
			endpoint: nextEndpoint === null ? null : normaliseEndpoint(nextEndpoint),
			installationId: current.installationId,
			crashReportingEnabled: input.crashReportingEnabled ?? current.crashReportingEnabled,
			lastCrashSubmitAttemptMs:
				input.lastCrashSubmitAttemptMs === undefined
					? current.lastCrashSubmitAttemptMs
					: input.lastCrashSubmitAttemptMs,
		};
		await this.writeToDisk(next);
		this.cache = next;
		return next;
	}

	private async readFromDisk(): Promise<FeedbackAppSettings> {
		let raw: string;
		try {
			raw = await fs.readFile(this.path, "utf8");
		} catch (_error) {
			const seeded = this.makeSeed();
			await this.writeToDisk(seeded);
			return seeded;
		}
		const parsed = safeJsonParse(raw);
		if (!parsed) {
			const seeded = this.makeSeed();
			await this.writeToDisk(seeded);
			return seeded;
		}
		const validated = validateAppSettings(parsed);
		if (!validated) {
			const seeded = this.makeSeed();
			await this.writeToDisk(seeded);
			return seeded;
		}
		if (validated.endpoint === null && this.buildTimeDefaultEndpoint !== null) {
			const filled: FeedbackAppSettings = {
				...validated,
				endpoint: this.buildTimeDefaultEndpoint,
			};
			await this.writeToDisk(filled);
			return filled;
		}
		return validated;
	}

	private async writeToDisk(value: FeedbackAppSettings): Promise<void> {
		await fs.mkdir(dirname(this.path), { recursive: true });
		const serialised = `${JSON.stringify(value, null, "\t")}\n`;
		await fs.writeFile(this.path, serialised, "utf8");
	}

	private makeSeed(): FeedbackAppSettings {
		const base = makeDefaultSettings(this.now(), this.random);
		if (this.buildTimeDefaultEndpoint !== null) {
			return { ...base, endpoint: this.buildTimeDefaultEndpoint };
		}
		return base;
	}
}

/** Helper for `index.ts` — compose the canonical path under userData. */
export function feedbackSettingsPath(userDataDir: string): string {
	return join(userDataDir, SETTINGS_FILE_NAME);
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch (_error) {
		return null;
	}
}

function validateAppSettings(input: unknown): FeedbackAppSettings | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const raw = input as Record<string, unknown>;
	const enabled = raw.enabled === true;
	let endpoint: string | null = null;
	if (raw.endpoint !== null && raw.endpoint !== undefined) {
		if (typeof raw.endpoint !== "string" || raw.endpoint.length === 0) return null;
		endpoint = normaliseEndpoint(raw.endpoint);
	}
	if (typeof raw.installationId !== "string" || raw.installationId.length === 0) return null;
	// Forward-compat: older files that predate Feedback-2 lack the crash
	// fields; default them in place rather than rejecting (and so re-
	// seeding the installationId).
	const crashReportingEnabled = raw.crashReportingEnabled === true;
	let lastCrashSubmitAttemptMs: number | null = null;
	if (
		typeof raw.lastCrashSubmitAttemptMs === "number" &&
		Number.isFinite(raw.lastCrashSubmitAttemptMs)
	) {
		lastCrashSubmitAttemptMs = raw.lastCrashSubmitAttemptMs;
	}
	return {
		enabled,
		endpoint,
		installationId: raw.installationId,
		crashReportingEnabled,
		lastCrashSubmitAttemptMs,
	};
}

function normaliseEndpoint(value: string): string {
	const trimmed = value.trim();
	return trimmed;
}
