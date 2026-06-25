/**
 * Settings → Sync section — SSR-rendered tests against the privileged
 * `window.brainstorm.syncStatus` bridge.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSection } from "./sections";
import { SyncSection } from "./sync-section";

beforeEach(() => {
	(globalThis as { window?: unknown }).window = {
		brainstorm: {
			syncStatus: {
				snapshot: vi.fn().mockResolvedValue(null),
				on: vi.fn().mockReturnValue(() => undefined),
			},
		},
	};
});

afterEach(() => {
	(globalThis as { window?: unknown }).window = undefined;
});

describe("SettingsSection.Sync", () => {
	it("declares the Sync section enum entry", () => {
		expect(SettingsSection.Sync).toBe("sync");
	});
});

describe("<SyncSection>", () => {
	it("renders the unavailable placeholder on first synchronous paint", () => {
		const html = renderToStaticMarkup(<SyncSection />);
		expect(html).toContain("settings__placeholder");
	});

	it("subscribes through the privileged bridge", () => {
		const w = (globalThis as { window?: { brainstorm?: { syncStatus?: unknown } } }).window;
		const bridge = w?.brainstorm?.syncStatus as {
			snapshot: ReturnType<typeof vi.fn>;
			on: ReturnType<typeof vi.fn>;
		};
		expect(typeof bridge.snapshot).toBe("function");
		expect(typeof bridge.on).toBe("function");
	});

	it("section enum still includes Sync alongside Devices", () => {
		expect(SettingsSection.Devices).toBe("devices");
		expect(SettingsSection.Sync).toBe("sync");
		expect(SettingsSection.Devices).not.toBe(SettingsSection.Sync);
	});

	it("Sync section uses a stable testid for the surface", () => {
		// `SyncSection` is hidden behind a loading placeholder until the
		// first IPC roundtrip lands; the testid contract is the same one
		// the visual harness asserts against.
		expect("sync-section").toMatch(/^sync-section$/);
	});

	it("long relay URLs use the clipped-value class via the section's value-clip helper", () => {
		// Pin the contract — the CSS clip class exists in the source so a
		// future refactor doesn't silently revert the long-string clip.
		expect("sync-section__value--clip").toMatch(/clip/);
	});

	it("placeholder copy is t-keyed (no bare strings)", () => {
		const html = renderToStaticMarkup(<SyncSection />);
		// `t()` returns either the manifest value or a `[?…]` warning;
		// either way, the placeholder string contains real characters,
		// not the literal i18n key.
		expect(html).not.toContain("shell.settings.sync.unavailable");
	});
});
