/**
 * Renderer-side adapter over the marketplace IPC surface. Mirrors the
 * `useDashboard` / `usePropertiesSnapshot` shape — declarative data hook
 * keeping the marketplace components React-friendly.
 *
 * No subscription channel today; the dashboard snapshot already pushes
 * theme changes (which drive the `installState: Active` flip), so the
 * marketplace re-pulls listings on dashboard updates.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	MarketplaceInstallResult,
	MarketplaceListing,
	MarketplaceSource,
	MarketplaceUpdate,
} from "../../preload/marketplace-types";

export type MarketplaceState = {
	listings: MarketplaceListing[] | null;
	sources: MarketplaceSource[] | null;
	/** Available catalog updates for installed apps; null while first loading. */
	updates: MarketplaceUpdate[] | null;
	loading: boolean;
	refresh: () => void;
	/** Apply one update (after the caller obtains consent for a NeedsConsent
	 *  update), then re-pull listings + updates. */
	applyUpdate: (appId: string) => Promise<MarketplaceInstallResult>;
};

export function useMarketplace(): MarketplaceState {
	const [listings, setListings] = useState<MarketplaceListing[] | null>(null);
	const [sources, setSources] = useState<MarketplaceSource[] | null>(null);
	const [updates, setUpdates] = useState<MarketplaceUpdate[] | null>(null);
	const cancelledRef = useRef(false);

	const fetchAll = useCallback(() => {
		void Promise.all([
			window.brainstorm.marketplace.listings(),
			window.brainstorm.marketplace.sources(),
		]).then(([nextListings, nextSources]) => {
			if (cancelledRef.current) return;
			setListings(nextListings);
			setSources(nextSources);
		});
	}, []);

	// Updates hit the catalog (network), so they're fetched on mount + on an
	// explicit refresh — NOT on every dashboard tick the way listings are.
	const fetchUpdates = useCallback(() => {
		void window.brainstorm.marketplace.checkUpdates().then((next) => {
			if (cancelledRef.current) return;
			setUpdates(next);
		});
	}, []);

	const applyUpdate = useCallback(
		async (appId: string): Promise<MarketplaceInstallResult> => {
			const result = await window.brainstorm.marketplace.applyUpdate(appId);
			if (!cancelledRef.current) {
				fetchAll();
				fetchUpdates();
			}
			return result;
		},
		[fetchAll, fetchUpdates],
	);

	useEffect(() => {
		cancelledRef.current = false;
		fetchAll();
		fetchUpdates();
		return () => {
			cancelledRef.current = true;
		};
	}, [fetchAll, fetchUpdates]);

	// Re-pull listings whenever the dashboard snapshot changes — theme
	// activation flips `installState: Active`, so the library / browse
	// grids stay in sync without their own pub/sub channel.
	useEffect(() => {
		return window.brainstorm.dashboard.on(() => {
			fetchAll();
		});
	}, [fetchAll]);

	return {
		listings,
		sources,
		updates,
		loading: listings === null || sources === null,
		refresh: () => {
			fetchAll();
			fetchUpdates();
		},
		applyUpdate,
	};
}
