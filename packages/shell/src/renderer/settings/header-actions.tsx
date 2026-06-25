/**
 * Header-actions slot — sections inject toolbar items (icon buttons) into
 * the shared `.settings__main-header` next to the persistent close button.
 *
 * Lives in its own module so section files (`search-section.tsx`, etc.)
 * don't need to import from `settings.tsx`, which would close a circular
 * import loop with the section registry there.
 */

import { type ReactNode, createContext, useContext } from "react";

export type SettingsHeaderActionsSetter = (node: ReactNode | null) => void;

export const SettingsHeaderActionsContext = createContext<SettingsHeaderActionsSetter | null>(null);

export function useSettingsHeaderActions(): SettingsHeaderActionsSetter {
	const setter = useContext(SettingsHeaderActionsContext);
	if (!setter) throw new Error("useSettingsHeaderActions must be used inside <Settings>");
	return setter;
}
