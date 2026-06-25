import { describe, expect, it } from "vitest";
import {
	MarketplaceContentKind,
	MarketplaceInstallState,
	type MarketplaceListing,
	MarketplaceListingSource,
} from "../../preload/marketplace-types";
import { countByKind, filterListings } from "./listing-filters";
import { KindFilter, MarketplacePanel } from "./panels";

const noteApp: MarketplaceListing = {
	kind: MarketplaceContentKind.App,
	id: "io.brainstorm.notes",
	version: "1.0.0",
	name: "Notes",
	summary: "Plain-text editor",
	source: MarketplaceListingSource.Sideload,
	sourceName: "Brainstorm",
	installState: MarketplaceInstallState.Installed,
};

const sepia: MarketplaceListing = {
	kind: MarketplaceContentKind.Theme,
	id: "sepia",
	version: "builtin",
	name: "shell.settings.themes.sepia.label",
	source: MarketplaceListingSource.BuiltIn,
	sourceName: "Brainstorm",
	installState: MarketplaceInstallState.Active,
};

const futureCatalogTheme: MarketplaceListing = {
	kind: MarketplaceContentKind.Theme,
	id: "io.example.dracula",
	version: "1.2.0",
	name: "Dracula",
	summary: "Classic dark theme",
	source: MarketplaceListingSource.Catalog,
	sourceName: "Acme catalog",
	installState: MarketplaceInstallState.NotInstalled,
};

const listings = [noteApp, sepia, futureCatalogTheme];

describe("filterListings", () => {
	it("Browse panel surfaces every listing regardless of install state", () => {
		const out = filterListings(listings, MarketplacePanel.Browse, KindFilter.All, "");
		expect(out).toHaveLength(3);
	});

	it("Library panel drops NotInstalled listings", () => {
		const out = filterListings(listings, MarketplacePanel.Library, KindFilter.All, "");
		expect(out).toHaveLength(2);
		expect(out.every((l) => l.installState !== MarketplaceInstallState.NotInstalled)).toBe(true);
	});

	it("Sources panel surfaces no listings (it has its own list)", () => {
		const out = filterListings(listings, MarketplacePanel.Sources, KindFilter.All, "");
		expect(out).toHaveLength(0);
	});

	it("Discover panel mirrors Browse until a curated source ships", () => {
		const out = filterListings(listings, MarketplacePanel.Discover, KindFilter.All, "");
		expect(out).toHaveLength(3);
	});

	it("Updates panel surfaces no listings until version-diff data exists", () => {
		const out = filterListings(listings, MarketplacePanel.Updates, KindFilter.All, "");
		expect(out).toHaveLength(0);
	});

	it("Apps kind filter keeps apps only", () => {
		const out = filterListings(listings, MarketplacePanel.Browse, KindFilter.Apps, "");
		expect(out.map((l) => l.id)).toEqual([noteApp.id]);
	});

	it("Themes kind filter keeps themes only", () => {
		const out = filterListings(listings, MarketplacePanel.Browse, KindFilter.Themes, "");
		expect(out.map((l) => l.id)).toEqual([sepia.id, futureCatalogTheme.id]);
	});

	it("Query matches name, summary, and id substrings case-insensitively", () => {
		expect(filterListings(listings, MarketplacePanel.Browse, KindFilter.All, "DRACULA")).toHaveLength(
			1,
		);
		expect(filterListings(listings, MarketplacePanel.Browse, KindFilter.All, "classic")).toHaveLength(
			1,
		);
		expect(
			filterListings(listings, MarketplacePanel.Browse, KindFilter.All, "io.brainstorm"),
		).toHaveLength(1);
	});

	it("Trimmed-empty query bypasses the search filter", () => {
		expect(filterListings(listings, MarketplacePanel.Browse, KindFilter.All, "   ")).toHaveLength(3);
	});
});

describe("countByKind", () => {
	it("Browse counts every listing per kind", () => {
		const counts = countByKind(listings, MarketplacePanel.Browse);
		expect(counts).toEqual({
			[KindFilter.All]: 3,
			[KindFilter.Apps]: 1,
			[KindFilter.Themes]: 2,
		});
	});

	it("Library counts drop NotInstalled rows", () => {
		const counts = countByKind(listings, MarketplacePanel.Library);
		expect(counts).toEqual({
			[KindFilter.All]: 2,
			[KindFilter.Apps]: 1,
			[KindFilter.Themes]: 1,
		});
	});

	it("Sources panel counts are all zero (it has its own list)", () => {
		const counts = countByKind(listings, MarketplacePanel.Sources);
		expect(counts).toEqual({
			[KindFilter.All]: 0,
			[KindFilter.Apps]: 0,
			[KindFilter.Themes]: 0,
		});
	});
});
