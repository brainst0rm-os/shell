/**
 * Renderer-side translate function per docs/foundations/35-code-conventions.md
 * §Localization and docs/platform/21-localization.md.
 *
 * Stage 12.1 wires the real runtime: FormatJS (`@formatjs/intl`) over an
 * ICU MessageFormat catalog. The source-language catalog lives in `en.json`
 * (code → catalog flow); v1 ships English only, so `en` is both the active
 * and the default locale. The contract callers depend on is the **id**, not
 * the value — when other locales land only the loaded message map changes and
 * call sites stay untouched.
 *
 * Plurals go through ICU (`{count, plural, one {…} other {…}}`), never a
 * `count === 1 ? …` branch in component code (doc-21 principle 5).
 */

import { type IntlShape, type OnErrorFn, createIntl, createIntlCache } from "@formatjs/intl";
import enMessages from "./en.json";

/** English is the source language + the ultimate fallback. */
const SOURCE_LOCALE = "en";

/** The active locale — English until the user picks another language (Track A
 *  runtime switch). Drives ICU plural rules + locale-sensitive formatting. */
let activeLocale = SOURCE_LOCALE;

export type TranslationParams = Record<string, string | number>;

/**
 * Mutable working copy of the catalog. `registerTranslations` (tests) merges
 * into it; `applyLocalePack` (the runtime language switch) replaces it with the
 * English base overlaid by the chosen locale's pack so untranslated keys fall
 * back to English. The intl instance is recreated on change and reuses the
 * compile cache.
 */
let messages: Record<string, string> = { ...enMessages };

const cache = createIntlCache();

/**
 * MISSING_TRANSLATION never reaches here — `t`/`tIfKey` guard on key presence
 * before formatting — so this only fires on a genuine ICU parse/format error
 * (e.g. a message that needs an interpolation value the caller didn't pass).
 * Surface it in dev; stay quiet in production.
 */
const onError: OnErrorFn = (err) => {
	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
		console.warn(`[i18n] ${err.code}: ${err.message}`);
	}
};

function makeIntl(): IntlShape {
	return createIntl(
		{ locale: activeLocale, defaultLocale: SOURCE_LOCALE, messages, onError },
		cache,
	);
}

let intl = makeIntl();

/**
 * Look up a translated string by id and format it with FormatJS (ICU).
 * Unknown ids return the id with a visible `[?…]` marker so missing-translation
 * bugs are obvious in dev. A known id whose ICU message needs an interpolation
 * value the caller omitted degrades to the raw message (FormatJS behavior) and
 * logs in dev.
 */
export function t(key: string, params?: TranslationParams): string {
	if (!(key in messages)) {
		if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
			console.warn(`[i18n] missing translation key: ${key}`);
		}
		return `[?${key}]`;
	}
	return intl.formatMessage({ id: key }, params);
}

/**
 * Translate a value that *might* be a translation key (e.g. a manifest's
 * theme labelKey) or a literal display string (e.g. an app's manifest
 * `name`). Returns the translation if the key is known, otherwise the
 * original value verbatim. Used by the marketplace listing chrome where
 * the same field carries both shapes across content kinds.
 */
export function tIfKey(value: string, params?: TranslationParams): string {
	if (!(value in messages)) return value;
	return intl.formatMessage({ id: value }, params);
}

/**
 * Register / override translations at runtime — the test helper and the future
 * per-locale pack loader both flow through here. Merges into the working
 * catalog and recompiles the intl instance.
 */
export function registerTranslations(pack: Record<string, string>): void {
	Object.assign(messages, pack);
	intl = makeIntl();
}

/**
 * Apply a locale at runtime (Track A language switch). Replaces the working
 * catalog with the English base overlaid by `pack` (so any key the pack omits
 * falls back to English), sets the active locale for ICU/format behaviour, and
 * recompiles. Passing the source locale with an empty pack resets to English.
 */
export function applyLocalePack(locale: string, pack: Record<string, string>): void {
	activeLocale = locale || SOURCE_LOCALE;
	messages = { ...enMessages, ...pack };
	intl = makeIntl();
}

/** The currently-active locale tag (e.g. `"en"`, `"es"`). */
export function getActiveLocale(): string {
	return activeLocale;
}
