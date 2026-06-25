import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "./crypto";
import {
	IDENTITY_EXPORT_AAD,
	IDENTITY_SECRET_BYTES,
	PairingChannelGuard,
	exportSecretSealed,
	importSecretSealed,
} from "./identity-export";

function randomIdentity(): Uint8Array {
	return generateSymmetricKey();
}

describe("identity-export (sealed user-Ed25519 secret)", () => {
	it("seal + open round-trips the identity secret", () => {
		const identity = randomIdentity();
		const pairingSecret = generateSymmetricKey();
		const sealed = exportSecretSealed(identity, pairingSecret);
		const opened = importSecretSealed(sealed, pairingSecret);
		expect(Buffer.compare(opened, identity)).toBe(0);
		expect(opened.length).toBe(IDENTITY_SECRET_BYTES);
	});

	it("AAD is domain-separated (open with no AAD or wrong AAD fails)", () => {
		// AAD is constant inside the module; this test pins that constant.
		expect(new TextDecoder().decode(IDENTITY_EXPORT_AAD)).toBe("brainstorm/v1/pair/identity-export");
	});

	it("rejects open with the wrong pairingSecret", () => {
		const identity = randomIdentity();
		const correct = generateSymmetricKey();
		const wrong = generateSymmetricKey();
		const sealed = exportSecretSealed(identity, correct);
		expect(() => importSecretSealed(sealed, wrong)).toThrowError();
	});

	it("rejects a tampered ciphertext", () => {
		const identity = randomIdentity();
		const pairingSecret = generateSymmetricKey();
		const sealed = exportSecretSealed(identity, pairingSecret);
		const ctBytes = Buffer.from(sealed.ciphertextB64, "base64");
		ctBytes[0] = (ctBytes[0] ?? 0) ^ 0xff;
		const tampered = { ...sealed, ciphertextB64: ctBytes.toString("base64") };
		expect(() => importSecretSealed(tampered, pairingSecret)).toThrowError();
	});

	it("rejects wrong-size identity / pairing secret arguments", () => {
		expect(() => exportSecretSealed(new Uint8Array(16), generateSymmetricKey())).toThrowError(
			/identitySecret/,
		);
		expect(() => exportSecretSealed(randomIdentity(), new Uint8Array(16))).toThrowError(
			/pairingSecret/,
		);
		const sealed = exportSecretSealed(randomIdentity(), generateSymmetricKey());
		expect(() => importSecretSealed(sealed, new Uint8Array(16))).toThrowError(/pairingSecret/);
	});
});

describe("PairingChannelGuard", () => {
	it("returns true on first consume, false on every subsequent consume", () => {
		const guard = new PairingChannelGuard();
		const secret = generateSymmetricKey();
		expect(guard.consume(secret)).toBe(true);
		expect(guard.consume(secret)).toBe(false);
		expect(guard.consume(secret)).toBe(false);
	});

	it("admits distinct secrets independently", () => {
		const guard = new PairingChannelGuard();
		expect(guard.consume(generateSymmetricKey())).toBe(true);
		expect(guard.consume(generateSymmetricKey())).toBe(true);
		expect(guard.consume(generateSymmetricKey())).toBe(true);
		expect(guard.size()).toBe(3);
	});

	it("clear() resets consumed set", () => {
		const guard = new PairingChannelGuard();
		const secret = generateSymmetricKey();
		guard.consume(secret);
		guard.clear();
		expect(guard.consume(secret)).toBe(true);
	});

	it("rejects empty input", () => {
		const guard = new PairingChannelGuard();
		expect(guard.consume(new Uint8Array(0))).toBe(false);
	});
});
