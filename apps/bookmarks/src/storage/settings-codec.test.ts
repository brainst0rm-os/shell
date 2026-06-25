import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKMARK_SETTINGS, SETTINGS_KEY, parseBookmarkSettings } from "./settings-codec";

describe("parseBookmarkSettings", () => {
	it("defaults downloadContentDefault to true", () => {
		expect(DEFAULT_BOOKMARK_SETTINGS.downloadContentDefault).toBe(true);
		expect(parseBookmarkSettings(null)).toEqual({ downloadContentDefault: true });
		expect(parseBookmarkSettings(undefined)).toEqual({ downloadContentDefault: true });
	});

	it("round-trips a stored false (the per-vault opt-out sticks)", () => {
		expect(parseBookmarkSettings({ downloadContentDefault: false })).toEqual({
			downloadContentDefault: false,
		});
	});

	it("round-trips a stored true", () => {
		expect(parseBookmarkSettings({ downloadContentDefault: true })).toEqual({
			downloadContentDefault: true,
		});
	});

	it("drops a malformed field back to the default", () => {
		expect(parseBookmarkSettings({ downloadContentDefault: "no" })).toEqual({
			downloadContentDefault: true,
		});
		expect(parseBookmarkSettings({ downloadContentDefault: 0 })).toEqual({
			downloadContentDefault: true,
		});
	});

	it("tolerates a legacy / wrong-shape record", () => {
		expect(parseBookmarkSettings([])).toEqual({ downloadContentDefault: true });
		expect(parseBookmarkSettings("on")).toEqual({ downloadContentDefault: true });
		expect(parseBookmarkSettings(42)).toEqual({ downloadContentDefault: true });
		expect(parseBookmarkSettings({ unrelated: true })).toEqual({ downloadContentDefault: true });
	});

	it("keeps the kv key stable", () => {
		expect(SETTINGS_KEY).toBe("bookmark-settings");
	});
});
