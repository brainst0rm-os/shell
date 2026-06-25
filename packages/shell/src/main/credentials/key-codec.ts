/**
 * Shared fixed-length key codecs (Stage 2/10). Ed25519 (identity + device) and
 * X25519 device keypairs all encode their 32-byte public keys to base64 and
 * length-check secrets identically — the byte-length codec is the only thing
 * they share. Curve-specific generate/sign/verify stay in each module; only
 * these length-checked base64 helpers + the secret-length guard live here.
 *
 * Crypto routing: lives under `main/credentials/`, the only place allowed to
 * touch key material, per CLAUDE.md.
 */

export function publicKeyToBase64(publicKey: Uint8Array, expectedLen: number): string {
	if (publicKey.length !== expectedLen) {
		throw new Error(`publicKeyToBase64: public key must be ${expectedLen} bytes`);
	}
	return Buffer.from(publicKey).toString("base64");
}

export function publicKeyFromBase64(encoded: string, expectedLen: number): Uint8Array {
	const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
	if (bytes.length !== expectedLen) {
		throw new Error(`publicKeyFromBase64: decoded key must be ${expectedLen} bytes`);
	}
	return bytes;
}

export function assertSecret(secretKey: Uint8Array, expectedLen: number): void {
	if (!(secretKey instanceof Uint8Array) || secretKey.length !== expectedLen) {
		throw new Error(`secretKey must be a ${expectedLen}-byte Uint8Array`);
	}
}
