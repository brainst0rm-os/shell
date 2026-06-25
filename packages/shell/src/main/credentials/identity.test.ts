import { describe, expect, it } from "vitest";
import {
	ED25519_PUBLIC_BYTES,
	ED25519_SECRET_BYTES,
	ED25519_SIGNATURE_BYTES,
	fingerprintPublicKey,
	generateIdentity,
	publicKeyFromBase64,
	publicKeyFromSecret,
	publicKeyToBase64,
	signPayload,
	verifySignature,
} from "./identity";

describe("identity", () => {
	it("generates an Ed25519 keypair with the right byte sizes", () => {
		const { secretKey, publicKey } = generateIdentity();
		expect(secretKey.length).toBe(ED25519_SECRET_BYTES);
		expect(publicKey.length).toBe(ED25519_PUBLIC_BYTES);
	});

	it("derives the public key from the secret key deterministically", () => {
		const { secretKey, publicKey } = generateIdentity();
		const derived = publicKeyFromSecret(secretKey);
		expect(Buffer.compare(derived, publicKey)).toBe(0);
	});

	it("sign + verify round-trips for the same keypair + payload", () => {
		const { secretKey, publicKey } = generateIdentity();
		const payload = new TextEncoder().encode("hello brainstorm");
		const signature = signPayload(secretKey, payload);
		expect(signature.length).toBe(ED25519_SIGNATURE_BYTES);
		expect(verifySignature(publicKey, payload, signature)).toBe(true);
	});

	it("verify fails on a tampered payload", () => {
		const { secretKey, publicKey } = generateIdentity();
		const payload = new TextEncoder().encode("hello");
		const signature = signPayload(secretKey, payload);
		const tampered = new TextEncoder().encode("hello!");
		expect(verifySignature(publicKey, tampered, signature)).toBe(false);
	});

	it("verify fails with a wrong public key", () => {
		const a = generateIdentity();
		const b = generateIdentity();
		const payload = new TextEncoder().encode("hi");
		const signature = signPayload(a.secretKey, payload);
		expect(verifySignature(b.publicKey, payload, signature)).toBe(false);
	});

	it("verify fails for a malformed signature", () => {
		const { publicKey } = generateIdentity();
		const payload = new TextEncoder().encode("hi");
		expect(verifySignature(publicKey, payload, new Uint8Array(63))).toBe(false);
		expect(verifySignature(publicKey, payload, new Uint8Array(65))).toBe(false);
	});

	it("verify fails for a malformed public key", () => {
		const { secretKey } = generateIdentity();
		const payload = new TextEncoder().encode("hi");
		const signature = signPayload(secretKey, payload);
		expect(verifySignature(new Uint8Array(31), payload, signature)).toBe(false);
	});

	it("fingerprintPublicKey produces the ed25519:<16hex> shape", () => {
		const { publicKey } = generateIdentity();
		const fingerprint = fingerprintPublicKey(publicKey);
		expect(fingerprint).toMatch(/^ed25519:[0-9a-f]{16}$/);
	});

	it("fingerprintPublicKey is deterministic for the same key", () => {
		const { publicKey } = generateIdentity();
		expect(fingerprintPublicKey(publicKey)).toBe(fingerprintPublicKey(publicKey));
	});

	it("publicKey round-trips through base64", () => {
		const { publicKey } = generateIdentity();
		const encoded = publicKeyToBase64(publicKey);
		const decoded = publicKeyFromBase64(encoded);
		expect(Buffer.compare(decoded, publicKey)).toBe(0);
	});

	it("rejects wrong-size keys at boundaries", () => {
		expect(() => publicKeyFromSecret(new Uint8Array(16))).toThrow(/32-byte/);
		expect(() => signPayload(new Uint8Array(16), new Uint8Array([1]))).toThrow(/32-byte/);
		expect(() => publicKeyToBase64(new Uint8Array(16))).toThrow(/32 bytes/);
		expect(() => fingerprintPublicKey(new Uint8Array(16))).toThrow(/32 bytes/);
		expect(() => publicKeyFromBase64(Buffer.from(new Uint8Array(16)).toString("base64"))).toThrow(
			/32 bytes/,
		);
	});
});
