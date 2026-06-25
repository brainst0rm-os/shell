import { describe, expect, it } from "vitest";
import {
	ED25519_DEVICE_PUBLIC_BYTES,
	ED25519_DEVICE_SECRET_BYTES,
	ED25519_DEVICE_SIGNATURE_BYTES,
	generateDeviceEd25519,
	publicKeyFromBase64,
	publicKeyFromSecret,
	publicKeyToBase64,
	signWithDeviceKey,
	verifyDeviceSignature,
} from "./device-ed25519";

describe("device-ed25519", () => {
	it("generates an Ed25519 keypair with the right byte sizes", () => {
		const { secretKey, publicKey } = generateDeviceEd25519();
		expect(secretKey.length).toBe(ED25519_DEVICE_SECRET_BYTES);
		expect(publicKey.length).toBe(ED25519_DEVICE_PUBLIC_BYTES);
	});

	it("derives the public key from the secret deterministically", () => {
		const { secretKey, publicKey } = generateDeviceEd25519();
		const derived = publicKeyFromSecret(secretKey);
		expect(Buffer.compare(derived, publicKey)).toBe(0);
	});

	it("two generations produce different keypairs (CSPRNG)", () => {
		const a = generateDeviceEd25519();
		const b = generateDeviceEd25519();
		expect(Buffer.compare(a.secretKey, b.secretKey)).not.toBe(0);
		expect(Buffer.compare(a.publicKey, b.publicKey)).not.toBe(0);
	});

	it("signs and verifies a payload round-trip", () => {
		const { secretKey, publicKey } = generateDeviceEd25519();
		const payload = new TextEncoder().encode("brainstorm/pair/handshake/test");
		const sig = signWithDeviceKey(secretKey, payload);
		expect(sig.length).toBe(ED25519_DEVICE_SIGNATURE_BYTES);
		expect(verifyDeviceSignature(publicKey, payload, sig)).toBe(true);
	});

	it("rejects a tampered signature", () => {
		const { secretKey, publicKey } = generateDeviceEd25519();
		const payload = new TextEncoder().encode("hello");
		const sig = signWithDeviceKey(secretKey, payload);
		sig[0] = (sig[0] ?? 0) ^ 0xff;
		expect(verifyDeviceSignature(publicKey, payload, sig)).toBe(false);
	});

	it("rejects a signature against a different pubkey", () => {
		const a = generateDeviceEd25519();
		const b = generateDeviceEd25519();
		const payload = new TextEncoder().encode("hello");
		const sig = signWithDeviceKey(a.secretKey, payload);
		expect(verifyDeviceSignature(b.publicKey, payload, sig)).toBe(false);
	});

	it("publicKey round-trips through base64", () => {
		const { publicKey } = generateDeviceEd25519();
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
		expect(() => signWithDeviceKey(new Uint8Array(16), new Uint8Array(0))).toThrow(/32-byte/);
	});
});
