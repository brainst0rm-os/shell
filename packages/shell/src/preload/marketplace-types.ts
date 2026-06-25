/**
 * Marketplace types + enums, isolated from `preload/index.ts` so the
 * renderer can `import` the enums as runtime values without dragging
 * the preload's `electron` import into the renderer bundle (which
 * crashes at load with `__dirname is not defined`).
 *
 * `preload/index.ts` re-exports these so existing call sites keep working.
 * Renderer modules that need the enums (e.g. `marketplace.tsx`'s switch
 * statements) should import from this file directly.
 */

export enum MarketplaceContentKind {
	App = "app",
	Theme = "theme",
}

export enum MarketplaceInstallState {
	NotInstalled = "not-installed",
	Installed = "installed",
	Active = "active",
}

export enum MarketplaceListingSource {
	BuiltIn = "built-in",
	Sideload = "sideload",
	Catalog = "catalog",
}

export type MarketplaceListing = {
	kind: MarketplaceContentKind;
	id: string;
	version: string;
	name: string;
	summary?: string;
	source: MarketplaceListingSource;
	sourceName: string;
	installState: MarketplaceInstallState;
	preview?: {
		background: string;
		surface: string;
		accent: string;
		text: string;
	};
};

export type MarketplaceSource = {
	id: string;
	name: string;
	builtIn: boolean;
};

export type MarketplaceInstallResult = { ok: true } | { ok: false; reason: string };

/** How an available update is gated (mirrors `UpdateClassification`). */
export enum MarketplaceUpdateClassification {
	/** No new capabilities — installs without a prompt. */
	Auto = "auto",
	/** Requests new capabilities — needs explicit consent before applying. */
	NeedsConsent = "needs-consent",
}

/** An available catalog update for an installed app (renderer view of
 *  `ClassifiedUpdate` — the UI doesn't need the bundle entry). */
export type MarketplaceUpdate = {
	id: string;
	name: string;
	fromVersion: string;
	toVersion: string;
	classification: MarketplaceUpdateClassification;
	/** Capabilities the new version adds (the consent diff); empty for Auto. */
	newCapabilities: string[];
};
