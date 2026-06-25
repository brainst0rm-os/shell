/**
 * Pure filtering / search helpers extracted out of the renderer so they
 * can be unit-tested without a DOM env (mirrors the Notes / database
 * app-level helper pattern).
 *
 * Search is a case-insensitive substring match against the listing's
 * `name` AND `summary`. Tight scope — the catalog will grow this surface
 * (tag / category / WCAG-level filters per 40-theme-store.md).
 */

import {
	MarketplaceContentKind,
	MarketplaceInstallState,
	type MarketplaceListing,
} from "../../preload/marketplace-types";
import { KindFilter, MarketplacePanel } from "./panels";

export function filterListings(
	listings: readonly MarketplaceListing[],
	panel: MarketplacePanel,
	kind: KindFilter,
	query: string,
): MarketplaceListing[] {
	const trimmedQuery = query.trim().toLowerCase();
	return listings.filter((listing) => {
		if (!matchesPanel(listing, panel)) return false;
		if (!matchesKind(listing, kind)) return false;
		if (trimmedQuery.length === 0) return true;
		return matchesQuery(listing, trimmedQuery);
	});
}

function matchesPanel(listing: MarketplaceListing, panel: MarketplacePanel): boolean {
	switch (panel) {
		case MarketplacePanel.Discover:
		case MarketplacePanel.Browse:
			return true;
		case MarketplacePanel.Library:
			return listing.installState !== MarketplaceInstallState.NotInstalled;
		case MarketplacePanel.Updates:
			// Updates is a saved filter on Library — entries whose installed
			// version is older than the listing's current version. v1 has no
			// remote catalog so the comparison is trivially "everything is
			// up to date"; surface the explicit empty state from the renderer.
			return false;
		case MarketplacePanel.Sources:
			return false;
	}
}

function matchesKind(listing: MarketplaceListing, kind: KindFilter): boolean {
	switch (kind) {
		case KindFilter.All:
			return true;
		case KindFilter.Apps:
			return listing.kind === MarketplaceContentKind.App;
		case KindFilter.Themes:
			return listing.kind === MarketplaceContentKind.Theme;
	}
}

function matchesQuery(listing: MarketplaceListing, query: string): boolean {
	if (listing.name.toLowerCase().includes(query)) return true;
	if (listing.summary?.toLowerCase().includes(query)) return true;
	if (listing.id.toLowerCase().includes(query)) return true;
	return false;
}

/** Count of listings per kind for the chip badges. Computed over the
 *  panel-filtered set so the chip reflects what's actually being shown. */
export function countByKind(
	listings: readonly MarketplaceListing[],
	panel: MarketplacePanel,
): Record<KindFilter, number> {
	const inPanel = listings.filter((l) => matchesPanel(l, panel));
	return {
		[KindFilter.All]: inPanel.length,
		[KindFilter.Apps]: inPanel.filter((l) => l.kind === MarketplaceContentKind.App).length,
		[KindFilter.Themes]: inPanel.filter((l) => l.kind === MarketplaceContentKind.Theme).length,
	};
}
