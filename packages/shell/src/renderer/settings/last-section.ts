/**
 * Device-local memory of the last-viewed Settings section.
 *
 * Settings previously always opened on Appearance. Persisting the last section
 * the user navigated to — device-scoped renderer `localStorage`, like the
 * last-locale / wallpaper / icon caches — lets Settings reopen where the user
 * left off. An explicit deep-link (`initialSection`) still wins over this.
 *
 * Stored as the bare enum value. Unknown / stale values are ignored: the reader
 * validates against the live `SettingsSection` enum and falls back to General.
 */

import { SettingsSection } from "./sections";

const STORAGE_KEY = "brainstorm.settings.lastSection";

const SECTION_VALUES = new Set<string>(Object.values(SettingsSection));

/** The last Settings section viewed on this device, or General on first run /
 *  when storage is unavailable or holds a stale value. */
export function readLastSettingsSection(): SettingsSection {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored && SECTION_VALUES.has(stored)) return stored as SettingsSection;
	} catch {
		// Storage disabled — fall through to the default.
	}
	return SettingsSection.General;
}

/** Record the section just viewed so the next open lands there. A storage
 *  failure is swallowed — the device simply forgets and falls back to General. */
export function rememberLastSettingsSection(section: SettingsSection): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, section);
	} catch {
		// Storage disabled / full — nothing to do; General is the fallback.
	}
}
