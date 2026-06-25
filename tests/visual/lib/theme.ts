/**
 * Switch the shell's appearance mode (light / dark / auto). Per-vault in
 * v1 — calling `setAppearanceMode` from the dashboard propagates the
 * applied theme to every open app window via the preload's theme bridge
 * (`packages/shell/src/preload/app-theme.ts`), so the visual harness only
 * needs to flip the mode once per theme pass.
 *
 * Includes a small settle delay so any CSS transitions on the dashboard +
 * already-open windows reach their resting state before the next capture.
 */

import type { Page } from "@playwright/test";
import type { VisualTheme } from "./state-registry";

type AppearanceApi = {
	dashboard: { setAppearanceMode: (mode: "light" | "dark" | "auto") => Promise<void> };
};

export async function setTheme(dashboard: Page, theme: VisualTheme): Promise<void> {
	await dashboard.evaluate(async (mode) => {
		const bs = (window as unknown as { brainstorm: AppearanceApi }).brainstorm;
		await bs.dashboard.setAppearanceMode(mode);
	}, theme);
	await dashboard.waitForTimeout(250);
}
