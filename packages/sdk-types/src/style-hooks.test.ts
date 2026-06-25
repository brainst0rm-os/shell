import { describe, expect, it } from "vitest";
import {
	STYLE_HOOK_ATTR,
	STYLE_HOOK_REGIONS,
	STYLE_HOOK_VERSION,
	isStyleHookRegion,
} from "./style-hooks";

describe("style-hooks contract", () => {
	it("pins the attribute name + version", () => {
		expect(STYLE_HOOK_ATTR).toBe("data-bs-region");
		expect(STYLE_HOOK_VERSION).toBe(1);
	});

	it("regions are unique, kebab-case, non-empty", () => {
		expect(new Set(STYLE_HOOK_REGIONS).size).toBe(STYLE_HOOK_REGIONS.length);
		for (const r of STYLE_HOOK_REGIONS) {
			expect(r).toMatch(/^[a-z]+(-[a-z]+)*$/);
		}
	});

	it("covers the core chrome surfaces", () => {
		for (const r of ["dashboard", "app-header", "settings", "popover", "lock-screen"]) {
			expect(STYLE_HOOK_REGIONS).toContain(r);
		}
	});

	it("guards membership", () => {
		expect(isStyleHookRegion("dashboard-header")).toBe(true);
		expect(isStyleHookRegion("not-a-region")).toBe(false);
	});
});
