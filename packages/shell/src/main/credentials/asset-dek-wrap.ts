/**
 * Asset-B1 — re-home a per-asset DEK from the vault-master-key wrap into the
 * referencing entity's Y.Doc, sealed under that entity's DEK.
 *
 * The at-rest half (`AssetStore` / `AssetDekStore`) seals each asset blob under
 * a fresh per-asset DEK and wraps that DEK under the **vault master key** in
 * `asset_deks`. That wrap is correct for local-at-rest but **cannot sync** — the
 * master key never leaves the device, so a second device that fetched the
 * ciphertext blob still couldn't open it (design [data/70]).
 *
 * This module produces the *syncable* wrap: the same 32-byte asset DEK sealed
 * under the **entity DEK** (which is itself member-wrapped per [16] and travels
 * inside the entity's Y.Doc). Nesting the asset key under the entity key makes
 * sharing + revocation inherit the member-wrap semantics for free — share the
 * entity and the recipient can already open the asset; rotate the entity DEK on
 * member removal and the asset follows.
 *
 * On-doc shape: the entity meta map (`brainstorm.meta`) carries an `assetDeks`
 * Y.Map keyed by `assetId`, each value an opaque `SealedSecret` (the same
 * base64-JSON envelope `asset_deks.sealed_dek_json` uses). The ydoc worker
 * stores the payload verbatim and stays crypto-free; all seal/open happens here
 * on the main side, exactly as `member-wraps.ts` keeps HPKE off the worker.
 *
 * AAD binds each wrap to (a) the scheme version, (b) the owning entity id, and
 * (c) the asset id — so a wrap minted for entity X cannot be replayed into
 * entity Y's doc, and a wrap for asset A cannot be moved to asset B's slot in
 * the same map. The prefix is DISTINCT from both the master-key asset-DEK AAD
 * (`brainstorm/asset-dek/v1:`) and the entity-DEK AAD, so the three binding
 * families can never cross-confuse.
 */

import { type SealedSecret, isSealedSecret, openSecret, sealSecret } from "./crypto";

/** Key within the entity meta map (`brainstorm.meta`) for the asset-DEK
 *  wrap map — a sibling of the member-wraps array (`wraps`). */
export const ENTITY_ASSET_DEKS_KEY = "assetDeks" as const;

/** Domain-separated AAD prefix for an asset DEK sealed under the entity DEK.
 *  Distinct from `ASSET_DEK_AAD_PREFIX` (master-key wrap) and the entity-DEK
 *  prefix so the binding families never cross-confuse. */
const ASSET_DEK_ENTITY_AAD_PREFIX = "brainstorm/asset-dek-entity/v1:";

/** A re-homed asset DEK as it lives on the entity Y.Doc: the opaque sealed
 *  envelope. The `assetId` is the map key (not stored in the payload); the
 *  `entityId` is the doc's identity — both fold into the AAD at seal/open. */
export type AssetDekWrap = SealedSecret;

export function isAssetDekWrap(value: unknown): value is AssetDekWrap {
	return isSealedSecret(value);
}

/**
 * Seal a 32-byte asset DEK under `entityDek`, bound to (`entityId`, `assetId`).
 * The returned envelope is JSON-ready for the entity Y.Doc's `assetDeks` map.
 * Neither key buffer is retained or zeroed here — the caller owns both
 * lifecycles (the asset DEK comes from `AssetDekStore.open`, the entity DEK
 * from `EntityDekStore.open`).
 */
export function sealAssetDekUnderEntity(
	assetDek: Uint8Array,
	entityDek: Uint8Array,
	entityId: string,
	assetId: string,
): AssetDekWrap {
	assertDek(assetDek);
	return sealSecret(entityDek, assetDek, assetDekEntityAad(entityId, assetId));
}

/**
 * Open a re-homed asset DEK wrap with `entityDek`. Throws on AAD mismatch (the
 * wrap was bound to a different entity/asset — defense vs. doc-slot swap),
 * wrong entity DEK, or tampered ciphertext. The caller MUST zero the returned
 * DEK.
 */
export function openAssetDekUnderEntity(
	wrap: AssetDekWrap,
	entityDek: Uint8Array,
	entityId: string,
	assetId: string,
): Uint8Array {
	if (!isAssetDekWrap(wrap)) {
		throw new Error("openAssetDekUnderEntity: invalid AssetDekWrap shape");
	}
	return openSecret(entityDek, wrap, assetDekEntityAad(entityId, assetId));
}

/** Canonical AAD: domain prefix || entityId || NUL || assetId. The NUL
 *  separator is unambiguous — safe entity ids and UUID asset ids never carry
 *  a NUL byte — so `(X, Y+Z)` and `(X+Y, Z)` can't collide. Centralised so the
 *  seal + open paths cannot drift. */
function assetDekEntityAad(entityId: string, assetId: string): Uint8Array {
	assertNonEmpty(entityId, "entityId");
	assertNonEmpty(assetId, "assetId");
	const nul = String.fromCharCode(0);
	return new TextEncoder().encode(ASSET_DEK_ENTITY_AAD_PREFIX + entityId + nul + assetId);
}

function assertDek(dek: Uint8Array): void {
	if (!(dek instanceof Uint8Array) || dek.length !== 32) {
		throw new Error("asset-dek-wrap: asset DEK must be a 32-byte Uint8Array");
	}
}

function assertNonEmpty(value: string, label: string): void {
	if (value === "") throw new Error(`asset-dek-wrap: ${label} must be non-empty`);
}
