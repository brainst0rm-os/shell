/**
 * `vault:network-settings:*` IPC handlers — let the dashboard renderer
 * read + mutate the shell-owned per-vault network settings (privacy
 * policy + optional proxy override) directly.
 *
 * The dashboard is a shell-trusted surface, so it talks to the
 * `VaultSession` over dedicated `ipcMain.handle` channels — not via the
 * broker. This mirrors how `properties-handlers.ts` handles the
 * vault-level property catalog and how `dashboard-handlers.ts` handles
 * the Dashboard / Wallpaper / Theme surfaces.
 *
 * **Privileged-only**: app renderers see nothing. Per doc-38 the per-
 * vault network setting is UX surface, not a brokered app capability —
 * apps that paste a URL get whatever preview policy the user chose for
 * the vault (Off / On / Allowlist / Manual), and they discover that
 * through the broker's typed `PreviewBlocked` error (Net-1e step 3).
 *
 * Subscribe-side: a `vault:network-settings:changed` push channel
 * re-broadcasts the new settings to the dashboard window AND every
 * app window on every successful `set`, so the Settings → Privacy
 * pane live-updates without polling AND apps repaint their
 * "previews are off" affordances. Same shape as `app:properties-changed`.
 */

import { type BrowserWindow, ipcMain } from "electron";
import { type AppWindow, isAppWindowLive } from "../apps/launcher";
import {
	DEFAULT_READ_LIMIT,
	DEFAULT_READ_WINDOW_MS,
	type NetworkAuditRecord,
	type PerAppNetworkSummary,
	filterBlockedRecords,
	readAuditRecords,
	summarizePerApp,
} from "../network/audit-log";
import type { LinkPreviewCache } from "../network/preview-cache";
import {
	DEFAULT_ON_PRIVACY,
	type PrivacyConfig,
	type VaultNetworkSettings,
	validateVaultNetworkSettings,
} from "../network/privacy-config";
import {
	DEFAULT_PROXY_CONFIG,
	type EffectiveProxyKind,
	type ProxyConfig,
	resolveEffectiveProxy,
} from "../network/proxy-config";
import { getActiveVaultSession } from "../vault/session";

export const VAULT_NETWORK_SETTINGS_GET_CHANNEL = "vault:network-settings:get";
export const VAULT_NETWORK_SETTINGS_SET_CHANNEL = "vault:network-settings:set";
/** Dashboard-bound: full new settings payload. */
export const VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL = "vault:network-settings:changed";
/** App-renderer-bound staleness signal — payload-free. Apps call
 *  `network.preview` and read the typed `PreviewBlocked` error when the
 *  vault flips to Off / Manual / Allowlist-miss; they don't read the
 *  settings directly. */
export const APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL = "app:vault-network-settings-changed";

/** Net-1f — privileged read-only channels that feed the Settings →
 *  Privacy → Network panel. Dashboard-only; never broker-exposed.
 *  Mirroring the pattern from `pairing:*` / `ledger:*` / `files-handles:*`. */
export const NETWORK_AUDIT_RECENT_CHANNEL = "network-audit:recent";
export const NETWORK_AUDIT_BLOCKED_CHANNEL = "network-audit:blocked";
export const NETWORK_AUDIT_PER_APP_SUMMARY_CHANNEL = "network-audit:per-app-summary";
export const NETWORK_CACHE_STATS_CHANNEL = "network-cache:stats";
export const NETWORK_CACHE_CLEAR_CHANNEL = "network-cache:clear";
export const NETWORK_BROKER_STATE_CHANNEL = "network-broker:state";

/** Net-1f §Per-app egress — last 7 days of audit records per doc-38
 *  §Network panel "byte counters (sent / received, last 7 days)". */
export const PER_APP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type NetworkCacheStats = {
	readonly entryCount: number;
	readonly oldestMs: number | null;
	readonly newestMs: number | null;
};

/** Composite "top of panel" snapshot — proxy + resolved-kind + privacy
 *  + cache stats. The renderer reads this once, then subscribes to the
 *  `vault:network-settings:changed` push channel for re-fetches. */
export type NetworkBrokerState = {
	readonly proxy: ProxyConfig;
	readonly resolvedProxyKind: EffectiveProxyKind;
	readonly privacy: PrivacyConfig;
	readonly previewCacheStats: NetworkCacheStats;
};

export type NetworkAuditRequest = {
	readonly fromMs?: number;
	readonly toMs?: number;
	readonly limit?: number;
};

type DashboardTargetGetter = () => BrowserWindow | null;
type AppWindowsGetter = () => readonly AppWindow[];
type CacheInvalidator = (next: VaultNetworkSettings, previous: VaultNetworkSettings | null) => void;
type AuditPathGetter = () => string;
type PreviewCacheGetter = () => LinkPreviewCache | null;

let getDashboardRef: DashboardTargetGetter | null = null;
let getAppWindowsRef: AppWindowsGetter | null = null;
let cacheInvalidator: CacheInvalidator | null = null;
let getAuditPathRef: AuditPathGetter | null = null;
let getPreviewCacheRef: PreviewCacheGetter | null = null;

export function registerNetworkSettingsHandlers(
	getDashboard: DashboardTargetGetter,
	options: {
		getAppWindows?: AppWindowsGetter;
		/** Called after every successful `set` AND on every `onVaultOpened`
		 *  hookup. Net-1e wires the preview-cache clear-on-privacy-flip
		 *  here so Off→On or Allowlist→Off etc. wipe the in-memory
		 *  preview cache (privacy-gone-cold should not leak). */
		onSettingsChanged?: CacheInvalidator;
		/** Net-1f — absolute path to the rotated audit log
		 *  (`<userData>/network-audit.jsonl`). When wired, the Net-1f
		 *  privileged read channels mount and return real data; absent →
		 *  channels return [] / null so tests + early-boot harness
		 *  don't crash. */
		getAuditPath?: AuditPathGetter;
		/** Net-1f — process-singleton preview cache. Same shape as
		 *  `getAuditPath`: absent → stats return zeroed + clear is a
		 *  no-op (handler stays callable). */
		getPreviewCache?: PreviewCacheGetter;
	} = {},
): void {
	getDashboardRef = getDashboard;
	getAppWindowsRef = options.getAppWindows ?? null;
	cacheInvalidator = options.onSettingsChanged ?? null;
	getAuditPathRef = options.getAuditPath ?? null;
	getPreviewCacheRef = options.getPreviewCache ?? null;

	ipcMain.handle(
		VAULT_NETWORK_SETTINGS_GET_CHANNEL,
		async (): Promise<VaultNetworkSettings | null> => {
			const session = getActiveVaultSession();
			if (!session) return null;
			return await session.vaultNetworkSettings();
		},
	);

	ipcMain.handle(VAULT_NETWORK_SETTINGS_SET_CHANNEL, async (_event, raw: unknown): Promise<void> => {
		const session = getActiveVaultSession();
		if (!session) throw new Error("no active vault session");
		const validated = validateVaultNetworkSettings(raw);
		if (!validated.ok) {
			const err = new Error(`vault network settings invalid: ${validated.detail}`);
			err.name = "Invalid";
			throw err;
		}
		const previous = session.cachedVaultNetworkSettings;
		await session.setVaultNetworkSettings(validated.settings);
		notifyChange(validated.settings, previous);
	});

	// Net-1f — privileged read-only audit + cache + broker-state channels.

	ipcMain.handle(
		NETWORK_AUDIT_RECENT_CHANNEL,
		async (_event, raw: unknown): Promise<readonly NetworkAuditRecord[]> => {
			const req = normalizeAuditRequest(raw);
			const auditPath = getAuditPathRef?.();
			if (!auditPath) return [];
			return await readAuditRecords(auditPath, req);
		},
	);

	ipcMain.handle(
		NETWORK_AUDIT_BLOCKED_CHANNEL,
		async (_event, raw: unknown): Promise<readonly NetworkAuditRecord[]> => {
			const req = normalizeAuditRequest(raw);
			const auditPath = getAuditPathRef?.();
			if (!auditPath) return [];
			const all = await readAuditRecords(auditPath, req);
			return filterBlockedRecords(all);
		},
	);

	ipcMain.handle(
		NETWORK_AUDIT_PER_APP_SUMMARY_CHANNEL,
		async (): Promise<readonly PerAppNetworkSummary[]> => {
			const auditPath = getAuditPathRef?.();
			if (!auditPath) return [];
			const now = Date.now();
			// Per doc-38 §Per-app egress — last 7 days. Lift the row cap
			// to the rotated cap so the summary picks up everything in
			// the window even when the per-call limit is the default 1000.
			const records = await readAuditRecords(auditPath, {
				fromMs: now - PER_APP_WINDOW_MS,
				toMs: now,
				limit: Number.MAX_SAFE_INTEGER,
			});
			return summarizePerApp(records);
		},
	);

	ipcMain.handle(NETWORK_CACHE_STATS_CHANNEL, async (): Promise<NetworkCacheStats> => {
		return computeCacheStats(getPreviewCacheRef?.() ?? null);
	});

	ipcMain.handle(NETWORK_CACHE_CLEAR_CHANNEL, async (): Promise<void> => {
		const cache = getPreviewCacheRef?.() ?? null;
		if (cache) cache.clear();
	});

	ipcMain.handle(NETWORK_BROKER_STATE_CHANNEL, async (): Promise<NetworkBrokerState> => {
		const session = getActiveVaultSession();
		const settings = session?.cachedVaultNetworkSettings ?? null;
		const proxy = settings?.proxyOverride ?? DEFAULT_PROXY_CONFIG;
		const privacy = settings?.privacy ?? DEFAULT_ON_PRIVACY;
		// Resolve against a representative URL so the renderer can show
		// "what mode is currently active" without consulting Chromium.
		// Doc-38 §Network panel: "Active proxy: what mode (system /
		// manual / PAC / direct), what's resolved for a representative URL".
		const resolved = resolveEffectiveProxy(proxy, "https://example.com/");
		return {
			proxy,
			resolvedProxyKind: resolved.kind,
			privacy,
			previewCacheStats: computeCacheStats(getPreviewCacheRef?.() ?? null),
		};
	});
}

/** Pure decision: validate the renderer-supplied window/limit args
 *  into the shape `readAuditRecords` accepts. Exported for tests. */
export function normalizeAuditRequest(input: unknown): {
	fromMs?: number;
	toMs?: number;
	limit?: number;
} {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const raw = input as Record<string, unknown>;
	const out: { fromMs?: number; toMs?: number; limit?: number } = {};
	if (typeof raw.fromMs === "number" && Number.isFinite(raw.fromMs)) out.fromMs = raw.fromMs;
	if (typeof raw.toMs === "number" && Number.isFinite(raw.toMs)) out.toMs = raw.toMs;
	if (typeof raw.limit === "number" && Number.isInteger(raw.limit) && raw.limit >= 0) {
		out.limit = Math.min(raw.limit, DEFAULT_READ_LIMIT * 10);
	}
	return out;
}

/** Pure helper — produce a `NetworkCacheStats` snapshot from a cache.
 *  Tolerates a null cache (early boot / test harness). Exported for tests. */
export function computeCacheStats(cache: LinkPreviewCache | null): NetworkCacheStats {
	if (!cache) {
		return { entryCount: 0, oldestMs: null, newestMs: null };
	}
	const stats = cache.statsSnapshot();
	return stats;
}

/** Per doc-38 §Network panel default-24h column window — re-exported
 *  for renderer-side defaults. */
export { DEFAULT_READ_WINDOW_MS };

/** Subscribe immediately so app windows receive change signals even
 *  when the user hasn't opened Settings yet. Idempotent; safe to call
 *  on every vault session activate. */
export function ensureNetworkSettingsBroadcast(session: ReturnType<typeof getActiveVaultSession>): {
	dispose: () => void;
} | null {
	if (!session) return null;
	const dispose = session.onVaultNetworkSettingsChanged((next, previous) => {
		notifyChange(next, previous);
	});
	return { dispose };
}

function notifyChange(next: VaultNetworkSettings, previous: VaultNetworkSettings | null): void {
	if (cacheInvalidator) {
		try {
			cacheInvalidator(next, previous);
		} catch (error) {
			console.warn("[brainstorm] network-settings cache invalidator threw:", error);
		}
	}
	const dashboard = getDashboardRef?.() ?? null;
	if (dashboard && !dashboard.isDestroyed()) {
		try {
			dashboard.webContents.send(VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL, next);
		} catch (error) {
			console.warn("[brainstorm] network-settings dashboard broadcast failed:", error);
		}
	}
	broadcastStaleSignalToAppWindows(getAppWindowsRef?.() ?? []);
}

/** Pure helper — push `app:vault-network-settings-changed` to every
 *  live app window. Exported for tests. */
export function broadcastStaleSignalToAppWindows(appWindows: readonly AppWindow[]): void {
	for (const win of appWindows) {
		if (!isAppWindowLive(win)) continue;
		try {
			win.webContents.send(APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL);
		} catch (error) {
			console.warn(`[brainstorm] vault-network-settings stale-signal to ${win.appId} failed:`, error);
		}
	}
}

/** Drop the broadcast wiring — called on dashboard close. */
export function disposeNetworkSettingsHandlers(): void {
	getDashboardRef = null;
	getAppWindowsRef = null;
	cacheInvalidator = null;
}

/** Pure check — should this settings flip wipe the in-memory preview
 *  cache? Every flip clears: an Off→On flip is symmetric (we don't
 *  want to surface previews that were cached before the user said
 *  "off"), an Allowlist host-list change must purge any now-off-list
 *  host's cached previews, and a Manual flip ditto. Same-config no-ops
 *  via `JSON.stringify` byte-equivalence (rare in practice — the IPC
 *  caller wrote a real change). */
export function shouldClearPreviewCacheOnChange(
	next: VaultNetworkSettings,
	previous: VaultNetworkSettings | null,
): boolean {
	if (!previous) return true;
	return JSON.stringify(next.privacy) !== JSON.stringify(previous.privacy);
}
