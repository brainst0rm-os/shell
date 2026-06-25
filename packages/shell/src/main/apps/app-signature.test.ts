import { describe, expect, it } from "vitest";
import { ed25519 } from "../test-support/crypto-test-helpers";
import {
	AppSignatureStatus,
	type ManifestSignature,
	type TrustedAppKeys,
	canonicalManifestBytes,
	extractManifestSignature,
	shouldBlockInstall,
	verifyManifestSignature,
} from "./app-signature";

const KEY_ID = "brainstorm-app-signing-1";
const pair = ed25519.keygen();
const secret = new Uint8Array(pair.secretKey);
const publicKey = new Uint8Array(pair.publicKey);

function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

/** A manifest with a valid Ed25519 signature over its canonical bytes. */
function signManifest(
	manifest: Record<string, unknown>,
	signSecret: Uint8Array = secret,
	keyId: string = KEY_ID,
): Record<string, unknown> {
	const bytes = canonicalManifestBytes(manifest);
	const sig = new Uint8Array(ed25519.sign(bytes, signSecret));
	const signature: ManifestSignature = { alg: "ed25519", keyId, value: bytesToBase64(sig) };
	return { ...manifest, signature };
}

const trusted: TrustedAppKeys = new Map([[KEY_ID, publicKey]]);
const baseManifest = { id: "io.example.app", name: "Example", version: "1.0.0" };

describe("canonicalManifestBytes", () => {
	it("ignores key ordering and strips the signature field", () => {
		const a = canonicalManifestBytes({ b: 2, a: 1, signature: { value: "x" } });
		const b = canonicalManifestBytes({ a: 1, b: 2 });
		expect(a).toEqual(b);
	});

	it("preserves array order", () => {
		const a = canonicalManifestBytes({ caps: ["x", "y"] });
		const b = canonicalManifestBytes({ caps: ["y", "x"] });
		expect(a).not.toEqual(b);
	});
});

describe("extractManifestSignature", () => {
	it("returns the block for a well-shaped signature", () => {
		const sig = extractManifestSignature({ signature: { alg: "ed25519", keyId: "k", value: "v" } });
		expect(sig).toEqual({ alg: "ed25519", keyId: "k", value: "v" });
	});

	it("treats a missing or malformed signature as absent", () => {
		expect(extractManifestSignature({})).toBeNull();
		expect(
			extractManifestSignature({ signature: { alg: "rsa", keyId: "k", value: "v" } }),
		).toBeNull();
		expect(extractManifestSignature({ signature: { alg: "ed25519", value: "v" } })).toBeNull();
		expect(extractManifestSignature(null)).toBeNull();
	});
});

describe("verifyManifestSignature", () => {
	it("reports Unsigned when no signature is present", () => {
		const result = verifyManifestSignature(baseManifest, trusted);
		expect(result.status).toBe(AppSignatureStatus.Unsigned);
	});

	it("reports Verified for a valid signature from a trusted key", () => {
		const signed = signManifest(baseManifest);
		const result = verifyManifestSignature(signed, trusted);
		expect(result.status).toBe(AppSignatureStatus.Verified);
		expect(result.keyId).toBe(KEY_ID);
	});

	it("reports Untrusted when the signer key is not in the registry", () => {
		const signed = signManifest(baseManifest);
		const result = verifyManifestSignature(signed, new Map());
		expect(result.status).toBe(AppSignatureStatus.Untrusted);
		expect(result.keyId).toBe(KEY_ID);
	});

	it("reports Invalid when the manifest content was tampered after signing", () => {
		const signed = signManifest(baseManifest);
		const tampered = { ...signed, version: "9.9.9" };
		const result = verifyManifestSignature(tampered, trusted);
		expect(result.status).toBe(AppSignatureStatus.Invalid);
	});

	it("reports Invalid when signed by a different key than the trusted one", () => {
		const otherSecret = new Uint8Array(ed25519.keygen().secretKey);
		const signed = signManifest(baseManifest, otherSecret, KEY_ID);
		const result = verifyManifestSignature(signed, trusted);
		expect(result.status).toBe(AppSignatureStatus.Invalid);
	});

	it("reports Invalid for a non-base64 signature value (never throws)", () => {
		const manifest = {
			...baseManifest,
			signature: { alg: "ed25519", keyId: KEY_ID, value: "!!!not base64!!!" },
		};
		const result = verifyManifestSignature(manifest, trusted);
		expect(result.status).toBe(AppSignatureStatus.Invalid);
	});
});

describe("shouldBlockInstall (enforcement chokepoint)", () => {
	it("never blocks under the v1 advisory policy (enforce false)", () => {
		for (const status of Object.values(AppSignatureStatus)) {
			expect(shouldBlockInstall(status, { enforce: false })).toBe(false);
		}
	});

	it("blocks only Untrusted/Invalid under enforcement", () => {
		expect(shouldBlockInstall(AppSignatureStatus.Unsigned, { enforce: true })).toBe(false);
		expect(shouldBlockInstall(AppSignatureStatus.Verified, { enforce: true })).toBe(false);
		expect(shouldBlockInstall(AppSignatureStatus.Untrusted, { enforce: true })).toBe(true);
		expect(shouldBlockInstall(AppSignatureStatus.Invalid, { enforce: true })).toBe(true);
	});
});
