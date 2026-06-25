/**
 * AssetDekStore — per-asset Data Encryption Key management for the binary-
 * asset subsystem. The exact `EntityDekStore` model, applied to assets:
 *
 *   - A fresh 32-byte XChaCha20-Poly1305 DEK is minted per asset (per-asset
 *     RANDOM key, NOT convergent — two byte-identical blobs get distinct
 *     DEKs/ciphertexts so the blind sync relay can't learn plaintext
 *     equality; OQ-236).
 *   - The DEK is sealed under the vault master key (`sealSecret`) and
 *     persisted in `asset_deks`. AAD = a domain-separated tag
 *     (`brainstorm/asset-dek/v1:` || UTF-8(assetId)) — a DISTINCT prefix
 *     from the entity-DEK prefix so an asset wrap can never be unwrapped as
 *     an entity wrap (or vice-versa), and repointing `assets.dek_id` to a
 *     stolen wrap invalidates the AEAD tag.
 *   - The plaintext DEK never crosses IPC; callers MUST `close(dek)`.
 *
 * **Forward contract for the sync wire path (Part B):** recompute AAD from
 * the resolved row's `asset_id`, never a caller-supplied id, and verify
 * `row.assetId === requestedAssetId` before unwrap — mirrors the
 * `EntityDekStore` forward-pin.
 */

import { openSecret, sealSecret } from "../credentials/crypto";
import type { AssetDeksRepository } from "../storage/entities-repo";

export type AssetDekHandle = {
	dekId: string;
	dek: Uint8Array;
};

/** Domain-separation prefix for the per-asset DEK AAD — distinct from the
 *  entity-DEK prefix so the two binding families never cross-confuse. */
const ASSET_DEK_AAD_PREFIX = "brainstorm/asset-dek/v1:";

export class AssetDekStore {
	readonly #deks: AssetDeksRepository;
	readonly #masterKey: Uint8Array;
	readonly #clock: () => number;

	constructor(
		deks: AssetDeksRepository,
		masterKey: Uint8Array,
		clock: () => number = () => Date.now(),
	) {
		this.#deks = deks;
		this.#masterKey = masterKey;
		this.#clock = clock;
	}

	/**
	 * Seal a caller-minted DEK under the vault master key (AAD-bound to
	 * `assetId`) and persist the wrap row under `dekId`. `AssetStore` owns the
	 * DEK lifecycle (the same bytes encrypt the blob), so this neither mints
	 * nor zeroes — it reads `dek` and returns. The parent `assets` row must
	 * already exist (`asset_deks.asset_id` FK, ON DELETE CASCADE); `AssetStore`
	 * inserts both in one transaction.
	 */
	seal(assetId: string, dekId: string, dek: Uint8Array): void {
		assertNonEmptyAssetId(assetId);
		const sealed = sealSecret(this.#masterKey, dek, assetIdAad(assetId));
		this.#deks.create({ dekId, assetId, sealedDek: sealed, now: this.#clock() });
	}

	/**
	 * Unwrap the persisted DEK for `assetId`. Returns null when no row exists.
	 * Throws on AAD mismatch (wrap bound to a different asset id), master-key
	 * mismatch, or tampered ciphertext. The caller MUST `close(dek)`.
	 */
	open(assetId: string): AssetDekHandle | null {
		assertNonEmptyAssetId(assetId);
		const row = this.#deks.getByAssetId(assetId);
		if (!row) return null;
		const dek = openSecret(this.#masterKey, row.sealedDek, assetIdAad(assetId));
		try {
			return { dekId: row.dekId, dek };
		} catch (error) {
			dek.fill(0);
			throw error;
		}
	}

	/** Zero a DEK buffer in place. Idempotent. */
	close(dek: Uint8Array): void {
		dek.fill(0);
	}
}

function assetIdAad(assetId: string): Uint8Array {
	return new TextEncoder().encode(ASSET_DEK_AAD_PREFIX + assetId);
}

function assertNonEmptyAssetId(assetId: string): void {
	if (assetId === "") throw new Error("AssetDekStore: assetId must be non-empty");
}
