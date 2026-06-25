import { describe, expect, it } from "vitest";
import { CURRENT_PERSISTED_VERSION, shouldRestorePersisted } from "./persisted-version";

describe("shouldRestorePersisted", () => {
	it("restores every schema version the app has ever written (1..current)", () => {
		// The original allowlist bug: v4/v5 payloads silently discarded.
		for (let v = 1; v <= CURRENT_PERSISTED_VERSION; v += 1) {
			expect(shouldRestorePersisted({ version: v })).toBe(true);
		}
	});

	it("restores a payload from a newer build (downgrade) rather than dropping state", () => {
		expect(shouldRestorePersisted({ version: CURRENT_PERSISTED_VERSION + 3 })).toBe(true);
	});

	it("rejects a missing / non-numeric / non-finite version", () => {
		expect(shouldRestorePersisted({})).toBe(false);
		expect(shouldRestorePersisted({ version: "5" })).toBe(false);
		expect(shouldRestorePersisted({ version: Number.NaN })).toBe(false);
		expect(shouldRestorePersisted({ version: 0 })).toBe(false);
		expect(shouldRestorePersisted({ version: -2 })).toBe(false);
	});

	it("rejects non-object payloads (corrupt disk row)", () => {
		expect(shouldRestorePersisted(null)).toBe(false);
		expect(shouldRestorePersisted(undefined)).toBe(false);
		expect(shouldRestorePersisted("graph:state")).toBe(false);
		expect(shouldRestorePersisted(42)).toBe(false);
	});
});
