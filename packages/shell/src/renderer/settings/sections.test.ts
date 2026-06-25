/**
 * Regression fence: every `SettingsSection` enum value must have a
 * matching `SECTIONS` entry whose `labelKey` resolves through the
 * shared i18n manifest. Without this, a future multi-word section
 * (kebab-case enum value, camelCase i18n key) would silently render
 * `[?shell.settings.section.<kebab>]` in the main header. The
 * `titleKeyFor` helper in `settings.tsx` consults `SECTIONS` exactly
 * so the title key never drifts from the sidebar label — this test
 * pins the contract from the outside.
 */

import { describe, expect, it } from "vitest";
import { t } from "../i18n/t";
import { SettingsSection } from "./sections";
import { SECTIONS } from "./settings";

describe("Settings SECTIONS — i18n key coverage", () => {
	it("every SettingsSection enum value has a registered SECTIONS entry", () => {
		const registered = new Set(SECTIONS.map((entry) => entry.id));
		const missing = (Object.values(SettingsSection) as SettingsSection[]).filter(
			(value) => !registered.has(value),
		);
		expect(missing, "SettingsSection values without a SECTIONS entry").toEqual([]);
	});

	it("every SECTIONS entry's labelKey resolves to a non-missing i18n string", () => {
		for (const entry of SECTIONS) {
			const value = t(entry.labelKey);
			expect(value, `labelKey=${entry.labelKey} for section=${entry.id}`).not.toMatch(/^\[\?/);
		}
	});

	it("multi-word enum values are not used as i18n keys directly", () => {
		// Defensive — a regression would be `t(\`shell.settings.section.${enumValue}\`)`
		// landing on a kebab-case key (e.g. `whats-new`) instead of the camelCase
		// i18n key. If a section's labelKey is exactly the kebab interpolation, the
		// helper is back to its pre-fix behaviour.
		for (const entry of SECTIONS) {
			const kebab = `shell.settings.section.${entry.id}`;
			if (kebab !== entry.labelKey) continue;
			// Equal kebab interpolation is fine ONLY when the labelKey actually
			// resolves; if it doesn't, the helper's fallback would surface `[?...]`.
			expect(t(entry.labelKey), `labelKey=${entry.labelKey}`).not.toMatch(/^\[\?/);
		}
	});
});
