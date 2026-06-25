/**
 * Marketplace top-level navigation panels per docs/apps/47-marketplace.md
 * §The Marketplace surface. Discover / Browse / Library / Updates / Sources
 * is the canonical layout; v1 ships Browse / Library / Sources — Discover
 * (featured / curated) and Updates (saved filter on Library) land when
 * remote catalog data exists.
 *
 * Per CLAUDE.md "no raw string literals as discriminators" — every panel id
 * is the enum member, never a bare literal. The marketplace.tsx switch reads
 * MarketplacePanel.X by name.
 */

export enum MarketplacePanel {
	Discover = "discover",
	Browse = "browse",
	Library = "library",
	Updates = "updates",
	Sources = "sources",
}

/** Optional kind filter applied on top of a panel — null means "all kinds". */
export enum KindFilter {
	All = "all",
	Apps = "apps",
	Themes = "themes",
}
