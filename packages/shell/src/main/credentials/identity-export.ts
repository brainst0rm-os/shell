/**
 * Sealed export / import of the sovereign user-Ed25519 secret over the
 * pairing channel (Stage 10.5a, OQ-198).
 *
 *   The user-Ed25519 secret is the *only* key that can sign add-device
 *   records, so a new device cannot join until it holds a copy. The
 *   pairing protocol delivers it sealed under a freshly-minted
 *   `pairingSecret` (32 bytes shared between the two devices through QR
 *   or SAS-confirmed ECDH).
 *
 *   The plaintext secret **never crosses IPC** and never appears in any
 *   renderer log: source-side `exportSecretSealed` runs entirely inside
 *   the main process (it reads `VaultSession.identitySecret` directly via
 *   the wrapping caller); recipient-side `importSecretSealed` opens the
 *   AEAD inside the main process and installs it into the keystore via
 *   the existing `KeystoreBackend.setSecret("identity", ...)` path.
 *
 *   Domain-separated AAD `brainstorm/v1/pair/identity-export` binds the
 *   ciphertext to this exact purpose — a sealed blob from this path
 *   cannot be replayed against any other AEAD consumer in the system.
 *
 *   Per-pairing-channel one-shot replay protection (OQ-198 resolution
 *   detail): callers track every `pairingSecret` previously consumed by
 *   `importSecretSealed` and reject a second open with the same secret
 *   (`SealedSecretAlreadyConsumed`). The protection lives in
 *   `PairingChannelGuard` — the import path is pure; the service-layer
 *   wrapper owns the guard.
 */

import { type SealedSecret, openSecret, sealSecret } from "./crypto";

export const IDENTITY_EXPORT_AAD = new TextEncoder().encode("brainstorm/v1/pair/identity-export");

export const IDENTITY_SECRET_BYTES = 32;

export function exportSecretSealed(
	identitySecret: Uint8Array,
	pairingSecret: Uint8Array,
): SealedSecret {
	if (!(identitySecret instanceof Uint8Array) || identitySecret.length !== IDENTITY_SECRET_BYTES) {
		throw new Error(`exportSecretSealed: identitySecret must be ${IDENTITY_SECRET_BYTES} bytes`);
	}
	if (!(pairingSecret instanceof Uint8Array) || pairingSecret.length !== 32) {
		throw new Error("exportSecretSealed: pairingSecret must be 32 bytes");
	}
	return sealSecret(pairingSecret, identitySecret, IDENTITY_EXPORT_AAD);
}

export function importSecretSealed(sealed: SealedSecret, pairingSecret: Uint8Array): Uint8Array {
	if (!(pairingSecret instanceof Uint8Array) || pairingSecret.length !== 32) {
		throw new Error("importSecretSealed: pairingSecret must be 32 bytes");
	}
	const plaintext = openSecret(pairingSecret, sealed, IDENTITY_EXPORT_AAD);
	if (plaintext.length !== IDENTITY_SECRET_BYTES) {
		throw new Error(
			`importSecretSealed: decrypted secret must be ${IDENTITY_SECRET_BYTES} bytes, got ${plaintext.length}`,
		);
	}
	return plaintext;
}

/**
 * Per-pairing-channel one-shot guard. `consume(secret)` returns false the
 * SECOND time a given `pairingSecret` is presented — the import service
 * must reject the open in that case so a captured ciphertext can't be
 * replayed if the underlying KEK leaked. Internal state is a Set of
 * base64-encoded pairing-secret bytes; the guard is process-local and
 * resets across shell restarts (the pairing payload also carries an
 * `expiresAt`, capping the relevant window).
 */
export class PairingChannelGuard {
	private readonly consumed = new Set<string>();

	consume(pairingSecret: Uint8Array): boolean {
		if (!(pairingSecret instanceof Uint8Array) || pairingSecret.length === 0) {
			return false;
		}
		const key = Buffer.from(pairingSecret).toString("base64");
		if (this.consumed.has(key)) return false;
		this.consumed.add(key);
		return true;
	}

	size(): number {
		return this.consumed.size;
	}

	clear(): void {
		this.consumed.clear();
	}
}
