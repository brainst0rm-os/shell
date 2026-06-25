/**
 * Remove dashboard icons that point at an app which isn't installed — so the
 * dashboard never shows an icon that errors `NotInstalled` on click (a stale
 * icon left by an uninstall, a build that didn't install, or a removed app).
 *
 * Only `kind: "app"` icons are considered; entity / view / shell-surface icons
 * are left alone. Run after seeding/bootstrap (when the installed set is final)
 * against `AppsRepository.listActive()` ids. Returns the removed app ids.
 */

import type { DashboardStore } from "./dashboard-store";

export function pruneOrphanAppIcons(
	dashboard: DashboardStore,
	installedAppIds: ReadonlySet<string>,
): string[] {
	const removed: string[] = [];
	for (const [iconId, icon] of Object.entries(dashboard.snapshot().icons)) {
		if (icon.kind === "app" && !installedAppIds.has(icon.target)) {
			dashboard.removeIcon(iconId);
			removed.push(icon.target);
		}
	}
	return removed;
}
