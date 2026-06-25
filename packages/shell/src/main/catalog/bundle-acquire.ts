/**
 * Shared bundle acquisition — download a catalog version's bundle, gate it on
 * **integrity (sha256)** then **authenticity (Ed25519 / TOFU)**, and unpack it
 * to a bundle dir. Used by both the install (14.32) and update (14.33) engines,
 * which only differ in whether they then call `AppInstaller.install` or
 * `.update`. Per §The install/update engines +
 * §Trust model.
 *
 * Every side-effecting dependency is injected; total — never throws.
 */

import type { CatalogVersion } from "./catalog-wire-types";

export enum BundleAcquireFailure {
	/** Download failed (offline, non-200). */
	DownloadFailed = "download-failed",
	/** The bytes' sha256 didn't match the catalog entry. */
	IntegrityFailed = "integrity-failed",
	/** The Ed25519 signature didn't verify against the publisher key. */
	SignatureFailed = "signature-failed",
	/** The `.brainstorm` archive failed to unpack. */
	UnpackFailed = "unpack-failed",
}

export type BundleAcquireDeps = {
	/** Download a bundle by URL → bytes. Rejects on failure (→ DownloadFailed). */
	readonly download: (url: string) => Promise<Uint8Array>;
	/** Hex sha256 of the bundle bytes (content address + integrity check). */
	readonly sha256Hex: (bytes: Uint8Array) => string;
	/** Verify the bundle's Ed25519 signature over its content hash against the
	 *  publisher key (TOFU). Returns false on any mismatch; total. */
	readonly verifyBundle: (
		bundleSha256Hex: string,
		signatureB64: string,
		publisherKey: string,
	) => boolean;
	/** Unpack the `.brainstorm` bytes to a temp bundle dir; returns its path. */
	readonly unpack: (bytes: Uint8Array) => Promise<string>;
};

export type BundleAcquireResult =
	| { ok: true; bundleDir: string }
	| { ok: false; failure: BundleAcquireFailure; reason: string };

/** Download → integrity gate → authenticity gate → unpack. */
export async function acquireBundle(
	entry: CatalogVersion,
	publisherKey: string,
	deps: BundleAcquireDeps,
): Promise<BundleAcquireResult> {
	let bytes: Uint8Array;
	try {
		bytes = await deps.download(entry.bundleUrl);
	} catch (e) {
		return {
			ok: false,
			failure: BundleAcquireFailure.DownloadFailed,
			reason: e instanceof Error ? e.message : String(e),
		};
	}

	// Integrity gate: the bytes must hash to the catalog's content address.
	const hash = deps.sha256Hex(bytes);
	if (hash !== entry.sha256) {
		return { ok: false, failure: BundleAcquireFailure.IntegrityFailed, reason: "sha256 mismatch" };
	}

	// Authenticity gate: the publisher's signature over that hash must verify.
	// An empty signature is rejected here even though the index validator allows
	// it (a catalog may *list* a not-yet-signed dev version) — you can never
	// *install* an unsigned bundle. Fail closed.
	if (entry.signature.length === 0 || !deps.verifyBundle(hash, entry.signature, publisherKey)) {
		return {
			ok: false,
			failure: BundleAcquireFailure.SignatureFailed,
			reason: entry.signature.length === 0 ? "bundle is unsigned" : "signature did not verify",
		};
	}

	let bundleDir: string;
	try {
		bundleDir = await deps.unpack(bytes);
	} catch (e) {
		return {
			ok: false,
			failure: BundleAcquireFailure.UnpackFailed,
			reason: e instanceof Error ? e.message : String(e),
		};
	}

	return { ok: true, bundleDir };
}
