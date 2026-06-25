/**
 * 14.34 — live catalog runtime: assembles the CatalogClient + InstallEngine in
 * the shell with their concrete electron-bound bindings (the pieces the unit
 * tests inject). The engine *chain* is proven in
 * `catalog-install-pipeline.test.ts`; this module is the glue that wires it to
 * real egress (`net.fetch`), the `.brainstorm` codec, and a session's
 * `AppInstaller`. Per §The catalog client + install engine.
 */

import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { net } from "electron";
import { InstallOrigin } from "../apps/install-provenance";
import type { AppInstaller } from "../apps/installer";
import type { AppsRepository } from "../storage/registry-repo/apps-repo";
import {
	bundleSha256Hex,
	unpackBrainstormBundleToDir,
	verifyBundleSignature,
} from "./brainstorm-package";
import { CatalogClient } from "./catalog-client";
import { catalogIndexUrl, fetchCatalogIndexJson } from "./catalog-fetch";
import { CatalogFileCache, catalogCachePath } from "./catalog-file-cache";
import { officialCatalogTrustedKeys } from "./catalog-trusted-keys";
import { InstallEngine } from "./install-engine";
import { UpdateEngine } from "./update-engine";
import type { InstalledForUpdate } from "./update-planning";

/** The shell's own egress to a catalog bundle URL (a fixed first-party origin,
 *  not app-influenced — same posture as the index fetch). Rejects on non-200. */
async function downloadBundle(url: string): Promise<Uint8Array> {
	const res = await net.fetch(url);
	if (!res.ok) throw new Error(`catalog bundle download HTTP ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

let client: CatalogClient | null = null;
let refreshed: Promise<unknown> | null = null;

/** The process-wide CatalogClient (one signed-index cache per install). */
export function getCatalogClient(userDataDir: string): CatalogClient {
	if (!client) {
		client = new CatalogClient({
			fetchIndexJson: () => fetchCatalogIndexJson(catalogIndexUrl()),
			trustedKeys: officialCatalogTrustedKeys(),
			cache: new CatalogFileCache({ path: catalogCachePath(userDataDir) }),
		});
	}
	return client;
}

/** Refresh the catalog index at most once per process boot (memoised); callers
 *  await it before reading listings so the first Marketplace open has data.
 *  Total — a failed refresh leaves the last-good cache and never throws here. */
export async function ensureCatalogRefreshed(c: CatalogClient): Promise<void> {
	if (!refreshed) refreshed = c.refresh().catch(() => undefined);
	await refreshed;
}

/** Unpack a downloaded bundle into a fresh staging dir (AppInstaller copies it
 *  into the vault from there). Shared by install + update. */
async function stagingUnpack(bytes: Uint8Array): Promise<string> {
	return unpackBrainstormBundleToDir(bytes, await mkdtemp(join(tmpdir(), "bs-catalog-stage-")));
}

/** Build an InstallEngine bound to a vault's installer + the real bindings. */
export function makeInstallEngine(catalog: CatalogClient, installer: AppInstaller): InstallEngine {
	return new InstallEngine({
		catalog,
		installer,
		download: downloadBundle,
		sha256Hex: bundleSha256Hex,
		verifyBundle: verifyBundleSignature,
		unpack: stagingUnpack,
	});
}

/** Currently-granted capabilities for an installed app — read from its installed
 *  manifest (what `AppInstaller.update` diffs against). Sync (small file). */
function installedCapabilities(repo: AppsRepository, id: string): string[] {
	const rec = repo.getActive(id);
	if (!rec) return [];
	try {
		const m = JSON.parse(readFileSync(join(rec.bundleDir, "manifest.json"), "utf8")) as {
			capabilities?: unknown;
		};
		return Array.isArray(m.capabilities)
			? m.capabilities.filter((c): c is string => typeof c === "string")
			: [];
	} catch {
		return [];
	}
}

/** Build an UpdateEngine bound to a vault — reconciles catalog-tracked installs
 *  against the cached index; fetches the new version's manifest for the
 *  capability-diff consent classification. */
export function makeUpdateEngine(
	catalog: CatalogClient,
	installer: AppInstaller,
	repo: AppsRepository,
	autoUpdate: () => boolean,
): UpdateEngine {
	return new UpdateEngine({
		catalog,
		installer,
		listInstalled: () =>
			repo.listActive().map(
				(r): InstalledForUpdate => ({
					id: r.id,
					version: r.version,
					channel: r.channel,
					catalogTracked:
						r.origin === InstallOrigin.BootstrapCache || r.origin === InstallOrigin.Catalog,
					publisherKey: r.publisherKey,
				}),
			),
		installedCapabilities: (id) => installedCapabilities(repo, id),
		fetchCapabilities: async (manifestUrl) => {
			const res = await net.fetch(manifestUrl);
			if (!res.ok) throw new Error(`manifest fetch HTTP ${res.status}`);
			const m = (await res.json()) as { capabilities?: unknown };
			return Array.isArray(m.capabilities)
				? m.capabilities.filter((c): c is string => typeof c === "string")
				: [];
		},
		autoUpdate,
		download: downloadBundle,
		sha256Hex: bundleSha256Hex,
		verifyBundle: verifyBundleSignature,
		unpack: stagingUnpack,
	});
}
