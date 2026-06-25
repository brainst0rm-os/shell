/**
 * `.bsbundle` — the canonical, lossless vault round-trip format (IE-1).
 *
 * Realises [docs/platform/45-import-export.md §Bundle format]. A `.bsbundle`
 * is a compressed tar archive: a small self-describing outer container
 * (magic + format version + compression algo) wrapping a deterministic tar
 * whose layout is the one doc 45 pins. This module owns the *shared
 * vocabulary* — constants, enums, record shapes — that the tar codec, the
 * export engine, and the import engine all speak. No I/O lives here.
 *
 * The byte-level round-trip guarantee (doc 45 §Round-trip guarantee) is the
 * load-bearing contract: export → import-as-new-vault → re-export must be
 * byte-equivalent modulo the documented ignore set (manifest timestamps,
 * provenance import stamps, importing identity).
 */

/** Outer-container magic — 4 ASCII bytes prefixing every `.bsbundle` file. */
export const BUNDLE_MAGIC = "BSB1";

/** Outer-container layout version (the framing, not the inner format). */
export const BUNDLE_CONTAINER_VERSION = 1;

/** Inner bundle-format semver. Importers reject incompatible majors. */
export const BUNDLE_FORMAT_VERSION = "1.0.0";

/** Canonical archive paths inside the tar (doc 45 §Bundle format). */
export const BundlePath = {
	Manifest: "manifest.json",
	Links: "links.jsonl",
	Provenance: "provenance.jsonl",
	Apps: "apps.json",
	EntitiesDir: "entities/",
	YdocDir: "ydoc/",
	BlobsDir: "blobs/",
	SchemasDir: "schemas/",
	AssetsManifest: "assets.jsonl",
} as const;

/** Outer-container compression. Self-described so the reader picks the right
 *  decompressor before it can see the inner manifest. `Gzip` is the portable
 *  default (present in every `node:zlib`); `Zstd` is used when the runtime
 *  exposes it (doc 45 names zstd; we degrade rather than add a native dep). */
export enum BundleCompression {
	None = "none",
	Gzip = "gzip",
	Zstd = "zstd",
}

/** What slice of the vault an export covers (OQ-245). */
export enum BundleExportScopeKind {
	/** Everything in the vault (the takeout / device-move default). */
	WholeVault = "whole-vault",
	/** A chosen set of entity types. */
	Types = "types",
	/** An entity and its descendants (a folder subtree). */
	Subtree = "subtree",
}

/** Conflict handling when an incoming entity id already exists in the target
 *  (doc 45 §Conflict resolution). Only meaningful for merge-into-existing
 *  imports; new-vault restore never collides. */
export enum BundleConflictStrategy {
	Skip = "skip",
	Duplicate = "duplicate",
	Overwrite = "overwrite",
	Merge = "merge",
	Stop = "stop",
}

export type BundleExportScope =
	| { readonly kind: BundleExportScopeKind.WholeVault }
	| { readonly kind: BundleExportScopeKind.Types; readonly types: readonly string[] }
	| { readonly kind: BundleExportScopeKind.Subtree; readonly rootId: string };

/** Declarative per-entity state (the BP-compatible `entities/<type>/<id>.json`
 *  body). Rich-text bodies live separately in `ydoc/<id>.bin`. */
export type BundleEntityRecord = {
	readonly id: string;
	readonly type: string;
	readonly properties: Record<string, unknown>;
	readonly createdBy: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly spaceId: string | null;
};

/** One typed edge (`links.jsonl`, one per line). */
export type BundleLinkRecord = {
	readonly id: string;
	readonly sourceEntityId: string;
	readonly destEntityId: string;
	readonly linkType: string;
	readonly createdAt: number;
};

/** Per-entity provenance (`provenance.jsonl`, one per line). `importedAt` /
 *  `importedBy` are stamped at import time and are in the round-trip ignore
 *  set; the original-source fields carry forward losslessly. */
export type BundleProvenanceRecord = {
	readonly entityId: string;
	readonly source: string;
	readonly sourceVersion?: string;
	readonly originalId?: string;
	readonly originalUrl?: string;
	readonly originalAuthor?: string;
	readonly importedAt?: string;
	readonly importedBy?: string;
	readonly importerApp?: string;
	readonly importerVersion?: string;
};

/** Content-addressed blob metadata (`assets.jsonl`). The bytes live at
 *  `blobs/<sha256>` (deduped by content hash); `assetId` is preserved so
 *  entity property references resolve in the restored vault. */
export type BundleAssetRecord = {
	readonly assetId: string;
	readonly contentHash: string;
	readonly mime: string;
	readonly kind: string;
	readonly byteLen: number;
	readonly originUrl: string | null;
	readonly bound: boolean;
};

/** Entity-type schema / property-def registration (`schemas/<type>.json`). */
export type BundleEntityTypeRecord = {
	readonly id: string;
	readonly introducedBy: string;
	readonly schemaUrl: string;
	readonly schemaInline: Record<string, unknown> | null;
	readonly registeredAt: number;
};

/** Installed-app reference (`apps.json`) — id + version, never source. */
export type BundleAppRecord = {
	readonly id: string;
	readonly version: string;
	readonly sdk: string;
	readonly signatureStatus: string;
	readonly signatureKeyId: string | null;
};

/** Which optional sections a bundle carries, so an importer can validate /
 *  surface coverage without scanning every entry. */
export type BundleSections = {
	readonly entities: boolean;
	readonly ydoc: boolean;
	readonly links: boolean;
	readonly provenance: boolean;
	readonly schemas: boolean;
	readonly blobs: boolean;
	readonly apps: boolean;
};

export type BundleManifest = {
	readonly bundleFormatVersion: string;
	readonly compression: BundleCompression;
	readonly createdAt: string;
	readonly generator: string;
	readonly scope: BundleExportScope;
	readonly vault: { readonly id: string | null; readonly name: string | null };
	readonly sections: BundleSections;
	readonly counts: {
		readonly entities: number;
		readonly links: number;
		readonly assets: number;
		readonly entityTypes: number;
		readonly apps: number;
	};
};

/** A non-destructive scan result the import wizard (IE-3) reviews before
 *  committing (doc 45 §The import flow step 5). */
export type ImportPlan = {
	readonly total: number;
	readonly created: number;
	readonly merged: number;
	readonly skipped: number;
	readonly unmapped: number;
	readonly warnings: readonly string[];
	readonly byType: Readonly<Record<string, number>>;
};

export type ImportReport = {
	readonly created: number;
	readonly skipped: number;
	readonly failed: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
	readonly linksRestored: number;
	readonly assetsWritten: number;
};

/** The fields a round-trip byte-comparison must ignore (doc 45 — timestamps
 *  in `manifest.json` and the import stamps in provenance). Exposed so the CI
 *  round-trip test and any future verifier share one definition. */
export const ROUND_TRIP_IGNORED_MANIFEST_KEYS: readonly string[] = ["createdAt"];
export const ROUND_TRIP_IGNORED_PROVENANCE_KEYS: readonly string[] = ["importedAt", "importedBy"];

/**
 * Entity / asset ids carried inside an (untrusted) bundle become filesystem
 * paths on restore (`YDocStore.pathFor`, `AssetStore` blob path). The tar layer
 * hardens *archive entry names* but the ids live inside the JSON records, so
 * they bypass that guard — validate them at the restore boundary instead. The
 * allowlist matches every real id shape (`ent_<base36>`, UUIDs) while rejecting
 * any separator / traversal segment.
 */
const SAFE_BUNDLE_ID = /^[A-Za-z0-9._-]+$/;

export function assertSafeBundleId(kind: string, id: string): void {
	if (!id || id === "." || id === ".." || !SAFE_BUNDLE_ID.test(id)) {
		throw new Error(`bundle: refusing unsafe ${kind} id: ${JSON.stringify(id)}`);
	}
}
