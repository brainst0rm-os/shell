import { describe, expect, it } from "vitest";
import {
	X25519_PUBLIC_BYTES,
	X25519_SECRET_BYTES,
	generateDeviceX25519,
	publicKeyFromBase64,
	publicKeyFromSecret,
	publicKeyToBase64,
} from "./device-x25519";

describe("device-x25519", () => {
	it("generates an X25519 keypair with the right byte sizes", () => {
		const { secretKey, publicKey } = generateDeviceX25519();
		expect(secretKey.length).toBe(X25519_SECRET_BYTES);
		expect(publicKey.length).toBe(X25519_PUBLIC_BYTES);
	});

	it("derives the public key from the secret deterministically", () => {
		const { secretKey, publicKey } = generateDeviceX25519();
		const derived = publicKeyFromSecret(secretKey);
		expect(Buffer.compare(derived, publicKey)).toBe(0);
	});

	it("two generations produce different keypairs (CSPRNG)", () => {
		const a = generateDeviceX25519();
		const b = generateDeviceX25519();
		expect(Buffer.compare(a.secretKey, b.secretKey)).not.toBe(0);
		expect(Buffer.compare(a.publicKey, b.publicKey)).not.toBe(0);
	});

	it("publicKey round-trips through base64", () => {
		const { publicKey } = generateDeviceX25519();
		const encoded = publicKeyToBase64(publicKey);
		const decoded = publicKeyFromBase64(encoded);
		expect(Buffer.compare(decoded, publicKey)).toBe(0);
	});

	it("rejects wrong-size keys at boundaries", () => {
		expect(() => publicKeyFromSecret(new Uint8Array(16))).toThrow(/32-byte/);
		expect(() => publicKeyToBase64(new Uint8Array(16))).toThrow(/32 bytes/);
		expect(() => publicKeyFromBase64(Buffer.from(new Uint8Array(16)).toString("base64"))).toThrow(
			/32 bytes/,
		);
	});
});
