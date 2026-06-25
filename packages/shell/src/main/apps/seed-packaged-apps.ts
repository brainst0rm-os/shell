/**
 * Production **bootstrap installer** (doc 59 / 14.30). In a packaged shell
 * the bundled apps live under `process.resourcesPath/apps/<dir>/dist`
 * (placed there by electron-builder's `extraResources`) — an offline-first
 * *cache* of catalog entries, not a parallel source of truth. On first
 * launch in a vault this module installs the curated **bootstrap set**
 * (`BOOTSTRAP_APPS` — Notes / Files / Database / Tasks / Calendar, OQ-LC-1)
 * via `installPrebuiltBundle`, with zero network. The remaining first-party
 * apps are **catalog-only**: installed on demand once the catalog client
 * lands (14.31+), never auto-seeded here.
 *
 * Installs stamp `InstallOrigin.BootstrapCache` (the installer's default
 * provenance) so the update engine reconciles them against the catalog like
 * any catalog install — the cache seeds the first run, the live catalog
 * keeps them current. Default-app updates therefore ship through the catalog,
 * independent of the shell binary (the two-update-planes separation).
 *
 * Dev-mode parity sits in `../dev/seed-demo-apps.ts`, which spawns
 * `vite build` first and installs **every** first-party app (stamped
 * `InstallOrigin.Dev`) until the seeder is retired at M5; the two share the
 * post-build `installPrebuiltBundle` half so the install/pin pipeline stays
 * single-sourced.
 *
 * 13.1a: this began as the packaged-mode counterpart to `seedDemoApps`. 13.3
 * adds a Playwright smoke around it; 13.6 layers shell auto-update.
 *
 * 13.10 — **upgrade path.** A shipped shell whose bundled first-party
 * manifests changed (new version, new capabilities — e.g. Mailbox-5's
 * `mail.manage`) must update the installed copy *and* grant the new
 * capabilities on the next boot; the dev seeder reinstalls every boot so
 * dev was unaffected, but the packaged seeder previously skipped any
 * already-registered app outright, so the app ran stale and new service
 * calls failed `Denied`. This module now compares the bundled manifest
 * against the registry row and routes a changed app through
 * `AppInstaller.update()` (which diffs + grants/revokes caps).
 *
 * Change signal (the WHY, recorded once here): the manifest **semantic
 * version** is authoritative. A bundled version strictly higher than the
 * registry row's is an upgrade. The **bundle content hash** is only the
 * tiebreak for the *same-version* case — a re-release that changed bytes
 * without bumping `version` (a shipping mistake for first-party apps, but
 * one we don't want to strand a user on). Version-first keeps the boot
 * cheap: the common no-op case (same version) reads two strings off the
 * registry row and the source manifest and stops, only hashing the source
 * tree when the versions match and we need to confirm the content is
 * genuinely unchanged. A bundled version *lower* than the row is never a
 * downgrade — a shell can't ship apps older than the vault already holds
 * through this path, so it's treated as no-op.
 */

import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DashboardStore } from "../dashboard/dashboard-store";
import { pruneOrphanAppIcons } from "../dashboard/prune-orphan-app-icons";
import { installPrebuiltBundle, placeDashboardIcon } from "../dev/seed-demo-apps";
import type { AppRecord, AppsRepository } from "../storage/registry-repo/apps-repo";
import { compareDottedVersions } from "../util/schema-version";
import { hashBundleDirectory } from "./app-bundle-hash";
import { shouldCopyBundleEntry } from "./bundle-filter";
import type { FirstPartyApp } from "./first-party";
import type { AppInstaller } from "./installer";
import { type AppManifest, validateManifest } from "./manifest";

export type BootstrapAppsDeps = {
	/** Absolute path to the prebuilt-apps tree (typically
	 *  `process.resourcesPath/apps`). Each entry's `<dir>/dist/` +
	 *  `<dir>/manifest.json` are read directly. */
	appsRoot: string;
	appsRepo: AppsRepository;
	installer: AppInstaller;
	dashboard: DashboardStore;
	/** The bootstrap set to install (the live wiring passes `BOOTSTRAP_APPS`).
	 *  Injected (not imported) so tests can pass a focused subset without
	 *  monkey-patching the registry. */
	apps: ReadonlyArray<FirstPartyApp>;
};

export type BootstrapAppsResult = {
	installed: string[];
	/** Apps already registered whose bundled manifest changed (version bump or
	 *  same-version content change) — routed through `AppInstaller.update()`. */
	upgraded: string[];
	skipped: string[];
	errors: string[];
};

/**
 * Reconcile every **bootstrap** app's cached copy with the vault registry.
 *
 * - **Install** an app whose `expectedAppId` is not active in `appsRepo`
 *   (fresh vault, or a previously-uninstalled app) — copies the bundle,
 *   writes the registry rows (stamped `InstallOrigin.BootstrapCache`),
 *   applies the manifest's capability grants, pins the dashboard icon.
 * - **Upgrade** an already-registered app whose bundled manifest changed
 *   (version bump, or same-version content change — see the module header
 *   for the change-signal decision) through `AppInstaller.update()`, which
 *   diffs capabilities and grants the new ones (the Mailbox-5 `mail.manage`
 *   bug: a shipped shell never granted the new cap, so the app ran stale).
 * - **Skip** an already-registered app whose bundle is unchanged.
 * - A partial failure (one app fails) doesn't abort the rest — failures
 *   land in `errors` and the remaining apps still go through.
 * - **Throw an actionable error** if `appsRoot` does not exist or has
 *   nothing in it. That's a "production build is broken" signal, not a
 *   silent no-op — a packaged shell with no `extraResources` is
 *   unusable and the user needs to know why.
 */
export async function bootstrapApps(deps: BootstrapAppsDeps): Promise<BootstrapAppsResult> {
	await assertAppsRootUsable(deps.appsRoot);

	const result: BootstrapAppsResult = {
		installed: [],
		upgraded: [],
		skipped: [],
		errors: [],
	};

	// Batch the per-app dashboard-icon writes into a single subscriber
	// notification so the icons paint together on first launch rather than
	// popping in one-by-one as each bundle finishes installing.
	await deps.dashboard.batch(async () => {
		for (const app of deps.apps) {
			const bundleDir = join(deps.appsRoot, app.dir);
			const existing = deps.appsRepo.getActive(app.expectedAppId);
			// A throwing reconcile (fs/SQL/ledger failure) must not unwind the
			// batch and abort the remaining apps — record it like a reported
			// failure so the rest of the dashboard still seeds.
			try {
				if (existing) {
					await reconcileRegistered(app, bundleDir, existing, deps, result);
				} else {
					await installFresh(app, bundleDir, deps, result);
				}
			} catch (e) {
				result.errors.push(`${app.dir}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	});

	// Drop dashboard icons whose app isn't installed (e.g. an app dropped from
	// the bundle, or a prior stale pin) so the dashboard never shows an icon
	// that errors NotInstalled on click.
	pruneOrphanAppIcons(deps.dashboard, new Set(deps.appsRepo.listActive().map((a) => a.id)));

	return result;
}

/** Fresh-install path (unchanged behaviour): copy the bundle, grant caps,
 *  pin the dashboard icon. */
async function installFresh(
	app: FirstPartyApp,
	bundleDir: string,
	deps: BootstrapAppsDeps,
	result: BootstrapAppsResult,
): Promise<void> {
	const outcome = await installPrebuiltBundle(app, bundleDir, {
		installer: deps.installer,
		appsRepo: deps.appsRepo,
		dashboard: deps.dashboard,
	});
	if (outcome.ok) {
		result.installed.push(outcome.id);
	} else {
		result.errors.push(`${app.dir}: ${outcome.reason}`);
	}
}

/** Already-registered path: read the bundled manifest, decide whether the
 *  bundle changed, and route an upgrade through `AppInstaller.update()` (caps
 *  diffed + granted/revoked). An unchanged bundle is skipped. */
async function reconcileRegistered(
	app: FirstPartyApp,
	bundleDir: string,
	existing: AppRecord,
	deps: BootstrapAppsDeps,
	result: BootstrapAppsResult,
): Promise<void> {
	const bundled = await readBundledManifest(bundleDir);
	if (!bundled) {
		// The registry already holds a working copy; a missing/corrupt bundled
		// manifest is a build problem but must not strand the installed app.
		// Keep the existing install and surface the build fault.
		result.errors.push(`${app.dir}: bundled manifest.json missing or invalid — kept installed copy`);
		return;
	}

	const change = await classifyBundleChange(bundled, bundleDir, existing);
	if (change === BundleChange.Unchanged) {
		result.skipped.push(existing.id);
		return;
	}

	if (change === BundleChange.VersionBump) {
		const outcome = await deps.installer.update({ bundleDir });
		if (outcome.ok) {
			result.upgraded.push(outcome.app.id);
			// Re-pin defensively in case the icon was removed; placeDashboardIcon
			// is a no-op when one already targets this app.
			placeDashboardIcon(deps.dashboard, outcome.app.id, app.label);
		} else {
			result.errors.push(`${app.dir}: ${outcome.reason}`);
		}
		return;
	}

	// SameVersionContentChange: `update()` refuses an equal version, so a
	// byte-changed re-release at the same version is applied by reinstalling
	// (uninstall vacuums the registry rows + revokes grants; install re-copies
	// and re-grants the manifest's current capabilities). Rare for first-party.
	const reinstalled = await installPrebuiltBundle(app, bundleDir, {
		installer: deps.installer,
		appsRepo: deps.appsRepo,
		dashboard: deps.dashboard,
	});
	if (reinstalled.ok) {
		result.upgraded.push(reinstalled.id);
	} else {
		result.errors.push(`${app.dir}: ${reinstalled.reason}`);
	}
}

enum BundleChange {
	Unchanged = "unchanged",
	VersionBump = "version-bump",
	SameVersionContentChange = "same-version-content-change",
}

/** Classify how the bundled copy differs from the registered one. Version is
 *  authoritative; the content hash is only consulted when versions are equal
 *  (the module header documents the WHY). The source tree is hashed with the
 *  installer's copy filter so it yields the same digest the installer recorded
 *  on the registry row (dev-only files / sourcemaps excluded identically). */
async function classifyBundleChange(
	bundled: AppManifest,
	bundleDir: string,
	existing: AppRecord,
): Promise<BundleChange> {
	const versionCmp = compareDottedVersions(bundled.version, existing.version);
	if (versionCmp > 0) return BundleChange.VersionBump;
	// Lower version is never a downgrade through this path — treat as no-op.
	if (versionCmp < 0) return BundleChange.Unchanged;

	const sourceHash = await hashBundleDirectory(bundleDir, (abs) =>
		shouldCopyBundleEntry(bundleDir, abs),
	);
	return sourceHash === existing.bundleSha256
		? BundleChange.Unchanged
		: BundleChange.SameVersionContentChange;
}

/** Read + validate `<bundleDir>/manifest.json`. Returns null on any read /
 *  parse / validation failure (caller keeps the installed copy). */
async function readBundledManifest(bundleDir: string): Promise<AppManifest | null> {
	try {
		const raw = await readFile(join(bundleDir, "manifest.json"), "utf8");
		const parsed = JSON.parse(raw);
		const validated = validateManifest(parsed);
		return validated.ok ? validated.manifest : null;
	} catch {
		return null;
	}
}

/**
 * Verify `appsRoot` exists and contains at least one entry. A packaged
 * shell with no `extraResources/apps` block is a build-time bug; failing
 * loudly here surfaces it on first launch instead of letting the user
 * stare at an empty dashboard.
 */
async function assertAppsRootUsable(appsRoot: string): Promise<void> {
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(appsRoot);
	} catch {
		throw new Error(
			`bootstrapApps: appsRoot "${appsRoot}" does not exist — the packaged build is missing its extraResources/apps tree`,
		);
	}
	if (!info.isDirectory()) {
		throw new Error(
			`bootstrapApps: appsRoot "${appsRoot}" is not a directory — the packaged build is malformed`,
		);
	}
	// Cheap sentinel: at least the apps dir needs to be reachable for read.
	try {
		await access(appsRoot);
	} catch {
		throw new Error(
			`bootstrapApps: appsRoot "${appsRoot}" is not readable — the packaged build is missing its extraResources/apps tree`,
		);
	}
}
