// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLastSettingsSection, rememberLastSettingsSection } from "./last-section";
import { SettingsSection } from "./sections";

const STORAGE_KEY = "brainstorm.settings.lastSection";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("last-settings-section", () => {
	it("returns General when nothing is stored", () => {
		expect(readLastSettingsSection()).toBe(SettingsSection.General);
	});

	it("round-trips the remembered section", () => {
		rememberLastSettingsSection(SettingsSection.Sync);
		expect(readLastSettingsSection()).toBe(SettingsSection.Sync);
	});

	it("falls back to General for a stale / unknown stored value", () => {
		window.localStorage.setItem(STORAGE_KEY, "no-such-section");
		expect(readLastSettingsSection()).toBe(SettingsSection.General);
	});

	it("tolerates storage that throws on read", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readLastSettingsSection()).toBe(SettingsSection.General);
	});

	it("tolerates storage that throws on write", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("quota");
		});
		expect(() => rememberLastSettingsSection(SettingsSection.Ai)).not.toThrow();
	});
});
