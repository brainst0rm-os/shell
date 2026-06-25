import { describe, expect, it } from "vitest";
import { x25519 } from "../test-support/crypto-test-helpers";
import { HPKE_SUITE, openBase, sealBase } from "./hpke";

/** Hex → bytes. RFC 9180 test vectors are hex strings. */
function hex(s: string): Uint8Array {
	const clean = s.replace(/\s+/g, "");
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.substr(i * 2, 2), 16);
	return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe("HPKE base mode (RFC 9180)", () => {
	it("pins the DHKEM(X25519,HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305 suite", () => {
		expect(HPKE_SUITE.kemId).toBe(0x0020);
		expect(HPKE_SUITE.kdfId).toBe(0x0001);
		expect(HPKE_SUITE.aeadId).toBe(0x0003);
		expect(HPKE_SUITE.nEnc).toBe(32);
		expect(HPKE_SUITE.nK).toBe(32);
		expect(HPKE_SUITE.nN).toBe(12);
	});

	/**
	 * RFC 9180 Appendix A.2.1 (DHKEM(X25519, HKDF-SHA256), HKDF-SHA256,
	 * ChaCha20Poly1305) base-mode setup + sequence-0 encryption. Pins the
	 * full key-schedule output (enc, ct) against the canonical vector so
	 * any regression in `extract`/`expand` labels, suite id bytes, or
	 * `concat()` ordering is caught loudly.
	 */
	it("matches the RFC 9180 A.2.1 base-mode test vector at sequence 0", () => {
		const info = hex("4f6465206f6e2061204772656369616e2055726e");
		const skEm = hex("f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600");
		const pkRm = hex("4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a");
		const skRm = hex("8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb");
		const expectedEnc = hex("1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a");
		const pt = hex("4265617574792069732074727574682c20747275746820626561757479");
		const aad = hex("436f756e742d30");
		const expectedCt = hex(
			"1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28",
		);

		const sealed = sealBase(pkRm, info, aad, pt, { ephemeralSecret: skEm });

		expect(Buffer.from(sealed.enc).toString("hex")).toBe(Buffer.from(expectedEnc).toString("hex"));
		expect(Buffer.from(sealed.ct).toString("hex")).toBe(Buffer.from(expectedCt).toString("hex"));

		const recovered = openBase(sealed.enc, skRm, info, aad, sealed.ct);
		expect(Buffer.from(recovered).toString("hex")).toBe(Buffer.from(pt).toString("hex"));
	});

	it("round-trips with fresh keys + random inputs", () => {
		for (let i = 0; i < 8; i++) {
			const recipient = x25519.keygen();
			const info = crypto.getRandomValues(new Uint8Array(16));
			const aad = crypto.getRandomValues(new Uint8Array(8));
			const pt = crypto.getRandomValues(new Uint8Array(32));
			const sealed = sealBase(recipient.publicKey, info, aad, pt);
			expect(sealed.enc.length).toBe(32);
			expect(sealed.ct.length).toBe(pt.length + 16);
			const opened = openBase(sealed.enc, recipient.secretKey, info, aad, sealed.ct);
			expect(bytesEqual(opened, pt)).toBe(true);
		}
	});

	it("OpenBase fails for the wrong recipient secret key", () => {
		const r1 = x25519.keygen();
		const r2 = x25519.keygen();
		const sealed = sealBase(
			r1.publicKey,
			new Uint8Array([1]),
			new Uint8Array([2]),
			new Uint8Array([3, 4, 5]),
		);
		expect(() =>
			openBase(sealed.enc, r2.secretKey, new Uint8Array([1]), new Uint8Array([2]), sealed.ct),
		).toThrow();
	});

	it("OpenBase fails for a mismatched info string", () => {
		const r = x25519.keygen();
		const sealed = sealBase(
			r.publicKey,
			new Uint8Array([1]),
			new Uint8Array([2]),
			new Uint8Array([3]),
		);
		expect(() =>
			openBase(sealed.enc, r.secretKey, new Uint8Array([9]), new Uint8Array([2]), sealed.ct),
		).toThrow();
	});

	it("OpenBase fails for a mismatched aad", () => {
		const r = x25519.keygen();
		const sealed = sealBase(
			r.publicKey,
			new Uint8Array([1]),
			new Uint8Array([2]),
			new Uint8Array([3]),
		);
		expect(() =>
			openBase(sealed.enc, r.secretKey, new Uint8Array([1]), new Uint8Array([9]), sealed.ct),
		).toThrow();
	});

	it("OpenBase fails on tampered ciphertext (Poly1305 auth failure)", () => {
		const r = x25519.keygen();
		const sealed = sealBase(
			r.publicKey,
			new Uint8Array([1]),
			new Uint8Array([2]),
			new Uint8Array([3, 4, 5]),
		);
		const tampered = new Uint8Array(sealed.ct);
		tampered.set([(tampered[0] ?? 0) ^ 1], 0);
		expect(() =>
			openBase(sealed.enc, r.secretKey, new Uint8Array([1]), new Uint8Array([2]), tampered),
		).toThrow();
	});

	it("rejects malformed recipient keys at the boundary", () => {
		expect(() =>
			sealBase(new Uint8Array(16), new Uint8Array(0), new Uint8Array(0), new Uint8Array([1])),
		).toThrow(/32 bytes/);
		const r = x25519.keygen();
		const sealed = sealBase(r.publicKey, new Uint8Array(0), new Uint8Array(0), new Uint8Array([1]));
		expect(() =>
			openBase(sealed.enc, new Uint8Array(16), new Uint8Array(0), new Uint8Array(0), sealed.ct),
		).toThrow(/32 bytes/);
		expect(() =>
			openBase(new Uint8Array(16), r.secretKey, new Uint8Array(0), new Uint8Array(0), sealed.ct),
		).toThrow(/32 bytes/);
	});

	it("produces different enc on every call (CSPRNG ephemeral)", () => {
		const r = x25519.keygen();
		const a = sealBase(r.publicKey, new Uint8Array(0), new Uint8Array(0), new Uint8Array([1]));
		const b = sealBase(r.publicKey, new Uint8Array(0), new Uint8Array(0), new Uint8Array([1]));
		expect(bytesEqual(a.enc, b.enc)).toBe(false);
		expect(bytesEqual(a.ct, b.ct)).toBe(false);
	});
});
