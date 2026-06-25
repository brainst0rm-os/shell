/**
 * Stable region ids for F6 / Shift+F6 region cycling — one variant per shell
 * region from `61-keyboard-accessibility.md §Tab order — the regions model`,
 * plus the open `Other` slot for app-declared regions whose label is an opaque
 * string.
 */
export enum RegionId {
	DashboardGrid = "dashboard-grid",
	VaultSwitcher = "vault-switcher",
	SystemTray = "system-tray",
	SettingsSidebar = "settings-sidebar",
	SettingsMain = "settings-main",
	MarketplaceSidebar = "marketplace-sidebar",
	MarketplaceMain = "marketplace-main",
	LauncherInput = "launcher-input",
	LauncherResults = "launcher-results",
	FindBar = "find-bar",
	AppHeader = "app-header",
	AppNavSidebar = "app-nav-sidebar",
	AppMain = "app-main",
	AppInspector = "app-inspector",
	Other = "other",
}
