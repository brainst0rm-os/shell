/**
 * Transient cross-surface theme preview (9.9.6; OQ-170). The theme-editor
 * asks the shell to paint a theme's token overrides across the dashboard +
 * every open app window for a few seconds — long enough to judge it at
 * scale — then auto-revert, WITHOUT committing the active theme. Capability
 * `theme.preview` (Medium); the shell fans the spec out to all renderers.
 *
 * **Security.** Preview vars cross from a sandboxed app to the privileged
 * dashboard + sibling app windows, so the spec is sanitized here (the one
 * trusted chokepoint): only **canonical token names** survive, each with a
 * value that can't break out of a CSS declaration or smuggle a fetch /
 * script. Renderers additionally apply via CSSOM `setProperty` (never
 * string-concatenated into a stylesheet), so this is defence in depth.
 *
 * Pure + dependency-free-ish leaf (only `token-names` + `token-set`), no
 * DOM, no timers; barrel-re-exported.
 */

import { isCanonicalTokenName } from "./token-names";
import { type TokenSetAppearance, isTokenSetAppearance } from "./token-set";

/** Default preview lifetime — long enough to read the result at scale. */
export const THEME_PREVIEW_DEFAULT_MS = 6000;
export const THEME_PREVIEW_MIN_MS = 500;
export const THEME_PREVIEW_MAX_MS = 30_000;
/** Cap a single token value's length — a sane CSS value is short; a long
 *  one is a smell (and bounds the cost of fanning it to every window). */
export const THEME_PREVIEW_MAX_VALUE_LEN = 200;

/** The request an app sends to preview a theme across the shell. */
export type ThemePreviewSpec = {
	/** Token overrides to paint, keyed by canonical `--kebab` name. */
	vars: Record<string, string>;
	/** Appearance hint so chrome that keys off light/dark can follow. */
	appearance?: TokenSetAppearance;
	/** How long before auto-revert (clamped to [MIN, MAX]). */
	durationMs?: number;
};

/** The sanitized payload the shell fans out to renderers. */
export type ThemePreviewPayload = {
	vars: Record<string, string>;
	appearance: TokenSetAppearance | null;
	durationMs: number;
};

export function clampPreviewDuration(ms: number | undefined): number {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return THEME_PREVIEW_DEFAULT_MS;
	return Math.max(THEME_PREVIEW_MIN_MS, Math.min(THEME_PREVIEW_MAX_MS, Math.round(ms)));
}

/** `true` if a token value could break out of its declaration or smuggle a
 *  resource / script. Rejected outright (never previewed). */
export function isUnsafePreviewValue(value: string): boolean {
	if (value.length === 0 || value.length > THEME_PREVIEW_MAX_VALUE_LEN) return true;
	// Declaration / selector break-out + markup.
	if (/[;{}<>]/.test(value)) return true;
	// A backslash is the ONLY way a value can carry a CSS escape (`\75 rl(…)`
	// → `url(…)`), which the substring scan below would miss but the CSSOM
	// unescapes when the renderer applies it via `style.setProperty`. No
	// legitimate token value (colour / length / number / keyword / `rgba(…)`)
	// needs a backslash, so rejecting it closes the entire escape-bypass
	// class while still allowing paren'd colour functions. (The StylePack
	// "CSS-escape sanitizer" lesson, applied to the preview path.)
	if (value.includes("\\")) return true;
	const lower = value.toLowerCase();
	// Script schemes, IE expression(), and any network/embedded fetch. With
	// escapes already barred above, these literal substrings are exhaustive.
	if (lower.includes("javascript:") || lower.includes("vbscript:")) return true;
	if (lower.includes("expression(")) return true;
	if (lower.includes("url(") || lower.includes("@import")) return true;
	return false;
}

/**
 * Reduce an arbitrary `ThemePreviewSpec` to the trusted payload actually
 * applied — drops every var that isn't a canonical token name with a safe,
 * non-blank string value; clamps the duration; validates the appearance.
 * Never throws.
 */
export function sanitizeThemePreview(
	spec: ThemePreviewSpec | null | undefined,
): ThemePreviewPayload {
	const out: Record<string, string> = {};
	const vars = spec?.vars;
	if (vars && typeof vars === "object") {
		for (const [name, raw] of Object.entries(vars)) {
			if (!isCanonicalTokenName(name)) continue;
			if (typeof raw !== "string") continue;
			const value = raw.trim();
			if (isUnsafePreviewValue(value)) continue;
			out[name] = value;
		}
	}
	return {
		vars: out,
		appearance: isTokenSetAppearance(spec?.appearance) ? spec.appearance : null,
		durationMs: clampPreviewDuration(spec?.durationMs),
	};
}
