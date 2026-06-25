import { describe, expect, it } from "vitest";
import {
	XCHACHA_KEY_BYTES,
	XCHACHA_NONCE_BYTES,
	base64ToBytes,
	bytesToBase64,
	generateSymmetricKey,
	isSealedSecret,
	openSecret,
	sealSecret,
} from "./crypto";

describe("crypto", () => {
	it("generateSymmetricKey produces 32 random bytes", () => {
		const k1 = generateSymmetricKey();
		const k2 = generateSymmetricKey();
		expect(k1).toBeInstanceOf(Uint8Array);
		expect(k1.length).toBe(XCHACHA_KEY_BYTES);
		expect(Buffer.compare(k1, k2)).not.toBe(0);
	});

	it("seal + open round-trips identically", () => {
		const key = generateSymmetricKey();
		const plaintext = new TextEncoder().encode("the quick brown fox jumps over the lazy dog");
		const sealed = sealSecret(key, plaintext);
		const opened = openSecret(key, sealed);
		expect(new TextDecoder().decode(opened)).toBe("the quick brown fox jumps over the lazy dog");
	});

	it("uses a fresh nonce per seal (same plaintext → different ciphertext)", () => {
		const key = generateSymmetricKey();
		const plaintext = new Uint8Array([1, 2, 3]);
		const s1 = sealSecret(key, plaintext);
		const s2 = sealSecret(key, plaintext);
		expect(s1.nonceB64).not.toBe(s2.nonceB64);
		expect(s1.ciphertextB64).not.toBe(s2.ciphertextB64);
	});

	it("rejects a wrong key", () => {
		const k1 = generateSymmetricKey();
		const k2 = generateSymmetricKey();
		const sealed = sealSecret(k1, new Uint8Array([1, 2, 3]));
		expect(() => openSecret(k2, sealed)).toThrow();
	});

	it("rejects tampered ciphertext (Poly1305 auth)", () => {
		const key = generateSymmetricKey();
		const sealed = sealSecret(key, new Uint8Array([1, 2, 3, 4]));
		const ct = Array.from(base64ToBytes(sealed.ciphertextB64));
		if (ct[0] !== undefined) ct[0] = (ct[0] ^ 0xff) & 0xff; // flip a byte
		const tampered = { ...sealed, ciphertextB64: bytesToBase64(new Uint8Array(ct)) };
		expect(() => openSecret(key, tampered)).toThrow();
	});

	it("AAD is authenticated — wrong AAD fails", () => {
		const key = generateSymmetricKey();
		const aad1 = new TextEncoder().encode("context-a");
		const aad2 = new TextEncoder().encode("context-b");
		const sealed = sealSecret(key, new Uint8Array([9, 9, 9]), aad1);
		expect(() => openSecret(key, sealed, aad2)).toThrow();
		const opened = openSecret(key, sealed, aad1);
		expect(Array.from(opened)).toEqual([9, 9, 9]);
	});

	it("nonce is exactly the XChaCha extended size", () => {
		const key = generateSymmetricKey();
		const sealed = sealSecret(key, new Uint8Array([1]));
		expect(base64ToBytes(sealed.nonceB64).length).toBe(XCHACHA_NONCE_BYTES);
	});

	it("rejects a malformed sealed shape", () => {
		const key = generateSymmetricKey();
		expect(() => openSecret(key, {} as never)).toThrow(/invalid/i);
		expect(() => openSecret(key, { v: 2, nonceB64: "", ciphertextB64: "" } as never)).toThrow(
			/invalid/i,
		);
	});

	it("rejects wrong-size keys", () => {
		const sealed = sealSecret(generateSymmetricKey(), new Uint8Array([1]));
		expect(() => sealSecret(new Uint8Array(16), new Uint8Array([1]))).toThrow(/32-byte/);
		expect(() => openSecret(new Uint8Array(16), sealed)).toThrow(/32-byte/);
	});

	it("isSealedSecret type guards", () => {
		const sealed = sealSecret(generateSymmetricKey(), new Uint8Array([1]));
		expect(isSealedSecret(sealed)).toBe(true);
		expect(isSealedSecret({})).toBe(false);
		expect(isSealedSecret(null)).toBe(false);
		expect(isSealedSecret({ v: 1, nonceB64: "", ciphertextB64: 0 })).toBe(false);
	});

	it("rejects nonces of the wrong size at open time", () => {
		const key = generateSymmetricKey();
		const sealed = sealSecret(key, new Uint8Array([1]));
		const shortNonce = { ...sealed, nonceB64: bytesToBase64(new Uint8Array(8)) };
		expect(() => openSecret(key, shortNonce)).toThrow(/nonce/);
	});
});
