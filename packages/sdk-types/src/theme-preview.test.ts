import { describe, expect, it } from "vitest";
import {
	THEME_PREVIEW_DEFAULT_MS,
	THEME_PREVIEW_MAX_MS,
	THEME_PREVIEW_MIN_MS,
	clampPreviewDuration,
	isUnsafePreviewValue,
	sanitizeThemePreview,
} from "./theme-preview";
import { TokenSetAppearance } from "./token-set";

describe("clampPreviewDuration", () => {
	it("defaults + clamps to [MIN, MAX]", () => {
		expect(clampPreviewDuration(undefined)).toBe(THEME_PREVIEW_DEFAULT_MS);
		expect(clampPreviewDuration(Number.NaN)).toBe(THEME_PREVIEW_DEFAULT_MS);
		expect(clampPreviewDuration(10)).toBe(THEME_PREVIEW_MIN_MS);
		expect(clampPreviewDuration(999_999)).toBe(THEME_PREVIEW_MAX_MS);
		expect(clampPreviewDuration(3000)).toBe(3000);
	});
});

describe("isUnsafePreviewValue", () => {
	it("rejects break-out + smuggling values", () => {
		expect(isUnsafePreviewValue("")).toBe(true);
		expect(isUnsafePreviewValue("a".repeat(201))).toBe(true);
		expect(isUnsafePreviewValue("red; } body{display:none")).toBe(true);
		expect(isUnsafePreviewValue("<script>")).toBe(true);
		expect(isUnsafePreviewValue("url(https://e.test/x.png)")).toBe(true);
		expect(isUnsafePreviewValue("expression(alert(1))")).toBe(true);
		expect(isUnsafePreviewValue("javascript:alert(1)")).toBe(true);
		expect(isUnsafePreviewValue("@import 'x'")).toBe(true);
		// CSS-escape bypass: `\75 rl(…)` unescapes to `url(…)` in the CSSOM,
		// slipping past a naive `url(` substring scan. The backslash reject
		// closes it.
		expect(isUnsafePreviewValue("\\75 rl(https://e.test/x.png)")).toBe(true);
		expect(isUnsafePreviewValue("\\000075rl(http://e.test)")).toBe(true);
	});

	it("accepts ordinary token values", () => {
		expect(isUnsafePreviewValue("#1a2b3c")).toBe(false);
		expect(isUnsafePreviewValue("rgba(0,0,0,0.5)")).toBe(false);
		expect(isUnsafePreviewValue("8px")).toBe(false);
		expect(isUnsafePreviewValue("system-ui, sans-serif")).toBe(false);
	});
});

describe("sanitizeThemePreview", () => {
	it("keeps only canonical tokens with safe values", () => {
		const out = sanitizeThemePreview({
			vars: {
				"--color-accent-default": "#268bd2",
				"--not-a-token": "#fff",
				"--color-text-primary": "red; }", // unsafe
				"--color-background-primary": "  #002b36  ", // trimmed
			},
		});
		expect(out.vars).toEqual({
			"--color-accent-default": "#268bd2",
			"--color-background-primary": "#002b36",
		});
	});

	it("validates appearance + clamps duration", () => {
		expect(sanitizeThemePreview({ vars: {}, appearance: TokenSetAppearance.Dark }).appearance).toBe(
			TokenSetAppearance.Dark,
		);
		expect(
			sanitizeThemePreview({ vars: {}, appearance: "bogus" as TokenSetAppearance }).appearance,
		).toBeNull();
		expect(sanitizeThemePreview({ vars: {}, durationMs: 2000 }).durationMs).toBe(2000);
	});

	it("never throws on malformed input", () => {
		expect(sanitizeThemePreview(null).vars).toEqual({});
		expect(sanitizeThemePreview({ vars: null as unknown as Record<string, string> }).vars).toEqual(
			{},
		);
	});
});
