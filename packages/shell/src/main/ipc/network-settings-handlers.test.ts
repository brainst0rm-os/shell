/**
 * `network-settings-handlers.ts` — broadcast helper + cache-invalidation
 * decision tests. The CRUD methods proxy through VaultSession (covered
 * separately under `vault/vault-network-settings-store.test.ts`); here
 * we only cover the broadcast helper + the privacy-flip → cache-clear
 * decision (the cache invalidator is the security-critical wiring).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn() },
}));

import type { AppWindow } from "../apps/launcher";
import { LinkPreviewCache } from "../network/preview-cache";
import { PrivacyMode } from "../network/privacy-config";
import {
	APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL,
	broadcastStaleSignalToAppWindows,
	computeCacheStats,
	normalizeAuditRequest,
	shouldClearPreviewCacheOnChange,
} from "./network-settings-handlers";

type FakeWindow = {
	appId: string;
	send: ReturnType<typeof vi.fn>;
	destroyed: boolean;
};

function fakeAppWindow(
	appId: string,
	opts: { destroyed?: boolean } = {},
): {
	win: AppWindow;
	rec: FakeWindow;
} {
	const rec: FakeWindow = {
		appId,
		send: vi.fn(),
		destroyed: opts.destroyed === true,
	};
	const win = {
		appId,
		windowId: "main",
		webContentsId: 0,
		webContents: { send: rec.send, isDestroyed: () => rec.destroyed },
	} as unknown as AppWindow;
	return { win, rec };
}

describe("broadcastStaleSignalToAppWindows", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends `app:vault-network-settings-changed` to every live app window", () => {
		const a = fakeAppWindow("io.brainstorm.notes");
		const b = fakeAppWindow("io.brainstorm.database");
		broadcastStaleSignalToAppWindows([a.win, b.win]);
		expect(a.rec.send).toHaveBeenCalledWith(APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL);
		expect(b.rec.send).toHaveBeenCalledWith(APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL);
	});

	it("skips destroyed windows", () => {
		const live = fakeAppWindow("io.brainstorm.notes");
		const dead = fakeAppWindow("io.brainstorm.database", { destroyed: true });
		broadcastStaleSignalToAppWindows([dead.win, live.win]);
		expect(dead.rec.send).not.toHaveBeenCalled();
		expect(live.rec.send).toHaveBeenCalledWith(APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL);
	});

	it("survives an individual webContents.send throwing", () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const failing = fakeAppWindow("io.brainstorm.notes");
		failing.rec.send.mockImplementation(() => {
			throw new Error("destroyed mid-send");
		});
		const live = fakeAppWindow("io.brainstorm.database");
		broadcastStaleSignalToAppWindows([failing.win, live.win]);
		expect(live.rec.send).toHaveBeenCalledWith(APP_VAULT_NETWORK_SETTINGS_CHANGED_CHANNEL);
		expect(consoleSpy).toHaveBeenCalled();
	});
});

describe("shouldClearPreviewCacheOnChange", () => {
	it("first write (no previous) → clear (cheap + safer)", () => {
		expect(
			shouldClearPreviewCacheOnChange(
				{ privacy: { mode: PrivacyMode.On }, proxyOverride: null },
				null,
			),
		).toBe(true);
	});

	it("Off → On flips → clear (cached previews from before Off must not appear after On either)", () => {
		expect(
			shouldClearPreviewCacheOnChange(
				{ privacy: { mode: PrivacyMode.On }, proxyOverride: null },
				{ privacy: { mode: PrivacyMode.Off }, proxyOverride: null },
			),
		).toBe(true);
	});

	it("On → Off flips → clear (privacy-gone-cold should not leak)", () => {
		expect(
			shouldClearPreviewCacheOnChange(
				{ privacy: { mode: PrivacyMode.Off }, proxyOverride: null },
				{ privacy: { mode: PrivacyMode.On }, proxyOverride: null },
			),
		).toBe(true);
	});

	it("Allowlist host-list shrink → clear", () => {
		expect(
			shouldClearPreviewCacheOnChange(
				{
					privacy: { mode: PrivacyMode.Allowlist, hosts: ["example.com"] },
					proxyOverride: null,
				},
				{
					privacy: {
						mode: PrivacyMode.Allowlist,
						hosts: ["example.com", "internal.tld"],
					},
					proxyOverride: null,
				},
			),
		).toBe(true);
	});

	it("identical privacy block + only proxy change → false (cache stays)", () => {
		expect(
			shouldClearPreviewCacheOnChange(
				{ privacy: { mode: PrivacyMode.On }, proxyOverride: { mode: "direct" } as never },
				{ privacy: { mode: PrivacyMode.On }, proxyOverride: null },
			),
		).toBe(false);
	});

	it("identical settings → false (no-op write)", () => {
		const settings = {
			privacy: { mode: PrivacyMode.On as const },
			proxyOverride: null,
		};
		expect(shouldClearPreviewCacheOnChange(settings, settings)).toBe(false);
	});
});

describe("normalizeAuditRequest (Net-1f IPC arg validator)", () => {
	it("returns empty object for non-object input", () => {
		expect(normalizeAuditRequest(null)).toEqual({});
		expect(normalizeAuditRequest(undefined)).toEqual({});
		expect(normalizeAuditRequest("nope")).toEqual({});
		expect(normalizeAuditRequest([1, 2, 3])).toEqual({});
	});

	it("strips unknown fields + keeps only fromMs / toMs / limit", () => {
		expect(normalizeAuditRequest({ fromMs: 100, toMs: 200, limit: 50, extra: "stuff" })).toEqual({
			fromMs: 100,
			toMs: 200,
			limit: 50,
		});
	});

	it("drops non-numeric fields silently", () => {
		expect(normalizeAuditRequest({ fromMs: "x", toMs: false, limit: "10" })).toEqual({});
	});

	it("rejects negative / non-integer limit", () => {
		expect(normalizeAuditRequest({ limit: -1 })).toEqual({});
		expect(normalizeAuditRequest({ limit: 1.5 })).toEqual({});
		expect(normalizeAuditRequest({ limit: Number.NaN })).toEqual({});
	});

	it("clamps very large limits (no unbounded reads)", () => {
		const out = normalizeAuditRequest({ limit: 1_000_000 });
		expect(out.limit).toBeLessThan(1_000_000);
		expect(out.limit).toBeGreaterThan(0);
	});

	it("accepts limit = 0 (empty result)", () => {
		expect(normalizeAuditRequest({ limit: 0 })).toEqual({ limit: 0 });
	});
});

describe("computeCacheStats", () => {
	it("zeroes out for a null cache (early boot)", () => {
		expect(computeCacheStats(null)).toEqual({
			entryCount: 0,
			oldestMs: null,
			newestMs: null,
		});
	});

	it("delegates to LinkPreviewCache.statsSnapshot", () => {
		const c = new LinkPreviewCache({ now: () => 100 });
		c.set("https://a/", "en", {
			url: "https://a/",
			canonicalUrl: "https://a/",
			title: "A",
			description: "",
			image: "",
			favicon: "",
			siteName: "",
			mediaType: "website",
			fetchedAt: 0,
		});
		expect(computeCacheStats(c)).toEqual({ entryCount: 1, oldestMs: 100, newestMs: 100 });
	});
});
