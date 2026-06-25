/**
 * 14.33 — UpdateEngine: reconcile catalog-tracked installs against the cached
 * catalog index and apply updates. This is the **app-update plane** (per
 * docs/apps/59 §Two update planes) — installed apps, **first-party included**,
 * update from the catalog on this cadence, independent of the Electron shell's
 * own binary update (13.6).
 *
 * Two-stage by design (per docs/apps/14 §Update behavior):
 *   - `check()` finds candidates with a newer version and **classifies** each
 *     by capability delta: a version requesting **no new capabilities** is
 *     auto-eligible; one requesting **new capabilities** needs an explicit
 *     consent prompt — capabilities never grow silently.
 *   - `applyAuto()` applies the auto-eligible set (gated on the user's
 *     auto-update setting); `apply(candidate)` applies one after consent.
 *
 * The apply path reuses `acquireBundle` (integrity + authenticity gates) and
 * `AppInstaller.update` (the registry + capability-diff chokepoint). Every IO
 * dependency is injected; total — never throws.
 */

import { InstallOrigin, OFFICIAL_CATALOG_ID } from "../apps/install-provenance";
import type { AppInstaller } from "../apps/installer";
import { diffCapabilities } from "../apps/manifest";
import { type BundleAcquireDeps, BundleAcquireFailure, acquireBundle } from "./bundle-acquire";
import type { CatalogClient } from "./catalog-client";
import {
	type InstalledForUpdate,
	type UpdateCandidate,
	planCatalogUpdates,
} from "./update-planning";

export enum UpdateClassification {
	/** No new capabilities — eligible for auto-update (subject to the setting). */
	Auto = "auto",
	/** Requests new capabilities — needs an explicit consent prompt first. */
	NeedsConsent = "needs-consent",
}

export type ClassifiedUpdate = UpdateCandidate & {
	/** Capabilities the new version requests that aren't already granted. */
	newCapabilities: string[];
	classification: UpdateClassification;
};

export enum UpdateOutcome {
	Updated = "updated",
	DownloadFailed = "download-failed",
	IntegrityFailed = "integrity-failed",
	SignatureFailed = "signature-failed",
	UnpackFailed = "unpack-failed",
	/** `AppInstaller.update` rejected. */
	UpdateFailed = "update-failed",
}

export type UpdateApplyResult =
	| { id: string; outcome: UpdateOutcome.Updated; version: string }
	| { id: string; outcome: Exclude<UpdateOutcome, UpdateOutcome.Updated>; reason: string };

export type UpdateEngineDeps = BundleAcquireDeps & {
	readonly catalog: CatalogClient;
	readonly installer: AppInstaller;
	/** The catalog-tracked installs to reconcile (mapped from `AppsRepository`). */
	readonly listInstalled: () => InstalledForUpdate[];
	/** Currently-granted capabilities for an installed app (for the diff). */
	readonly installedCapabilities: (id: string) => string[];
	/** Fetch the new version's declared capabilities (from its manifest URL). */
	readonly fetchCapabilities: (manifestUrl: string) => Promise<string[]>;
	/** The user's auto-update setting; `applyAuto` no-ops when false. */
	readonly autoUpdate: () => boolean;
	readonly catalogId?: string;
};

function acquireFailureToOutcome(
	failure: BundleAcquireFailure,
): Exclude<UpdateOutcome, UpdateOutcome.Updated | UpdateOutcome.UpdateFailed> {
	switch (failure) {
		case BundleAcquireFailure.DownloadFailed:
			return UpdateOutcome.DownloadFailed;
		case BundleAcquireFailure.IntegrityFailed:
			return UpdateOutcome.IntegrityFailed;
		case BundleAcquireFailure.SignatureFailed:
			return UpdateOutcome.SignatureFailed;
		case BundleAcquireFailure.UnpackFailed:
			return UpdateOutcome.UnpackFailed;
	}
}

export class UpdateEngine {
	private readonly deps: UpdateEngineDeps;

	constructor(deps: UpdateEngineDeps) {
		this.deps = deps;
	}

	/**
	 * Find available updates and classify each by capability delta. Reads the
	 * cached index (a fresh fetch is the caller's job — `CatalogClient.refresh()`
	 * — so `check()` stays cheap + offline-tolerant).
	 */
	async check(): Promise<ClassifiedUpdate[]> {
		const index = this.deps.catalog.cachedIndex();
		if (!index) return [];
		const candidates = planCatalogUpdates(this.deps.listInstalled(), index);
		const classified: ClassifiedUpdate[] = [];
		for (const candidate of candidates) {
			const newCaps = await this.fetchNewCapabilities(candidate);
			const added = diffCapabilities(this.deps.installedCapabilities(candidate.id), newCaps).added;
			classified.push({
				...candidate,
				newCapabilities: added,
				classification:
					added.length > 0 ? UpdateClassification.NeedsConsent : UpdateClassification.Auto,
			});
		}
		return classified;
	}

	/** Apply every auto-eligible (no-new-capability) update — gated on the user's
	 *  auto-update setting. Returns one result per applied update. */
	async applyAuto(): Promise<UpdateApplyResult[]> {
		if (!this.deps.autoUpdate()) return [];
		const updates = await this.check();
		const results: UpdateApplyResult[] = [];
		for (const update of updates) {
			if (update.classification !== UpdateClassification.Auto) continue;
			results.push(await this.apply(update));
		}
		return results;
	}

	/**
	 * Apply one update: acquire (integrity + authenticity gates) → unpack →
	 * `AppInstaller.update`, stamping the bumped catalog version. The installer
	 * diffs + grants/revokes capabilities itself; for a `NeedsConsent` candidate
	 * the caller must have obtained consent before calling this.
	 */
	async apply(candidate: UpdateCandidate): Promise<UpdateApplyResult> {
		const acquired = await acquireBundle(candidate.entry, candidate.publisherKey, this.deps);
		if (!acquired.ok) {
			return {
				id: candidate.id,
				outcome: acquireFailureToOutcome(acquired.failure),
				reason: acquired.reason,
			};
		}
		const result = await this.deps.installer.update({
			bundleDir: acquired.bundleDir,
			provenance: {
				origin: InstallOrigin.Catalog,
				catalogId: this.deps.catalogId ?? OFFICIAL_CATALOG_ID,
				channel: candidate.channel,
				publisherKey: candidate.publisherKey,
				catalogVersion: candidate.toVersion,
			},
		});
		if (!result.ok) {
			return { id: candidate.id, outcome: UpdateOutcome.UpdateFailed, reason: result.reason };
		}
		return { id: candidate.id, outcome: UpdateOutcome.Updated, version: result.app.version };
	}

	private async fetchNewCapabilities(candidate: UpdateCandidate): Promise<string[]> {
		try {
			const caps = await this.deps.fetchCapabilities(candidate.entry.manifestUrl);
			// A resolved non-array (HTTP 200 with a garbage body) is as unreadable
			// as a rejection — fall through to the conservative path rather than
			// letting `diffCapabilities`'s `.filter` throw (breaking `check()`'s
			// total contract).
			if (Array.isArray(caps)) return caps;
		} catch {
			// fall through
		}
		// Can't read the new caps → treat as "has changes" so we never auto-grant
		// blind; the conservative path is to require consent.
		return [`__unknown__:${candidate.id}`];
	}
}
