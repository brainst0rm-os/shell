import { describe, expect, it } from "vitest";
import {
	MEDIA_SEAL_MAGIC,
	VaultMediaDomain,
	deriveMediaKey,
	isSealedMedia,
	openMedia,
	sealMedia,
} from "./vault-media-crypto";

const master = new Uint8Array(32).fill(7);
const key = deriveMediaKey(master);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("deriveMediaKey", () => {
	it("is deterministic and 32 bytes", () => {
		expect(deriveMediaKey(master)).toEqual(key);
		expect(key.length).toBe(32);
	});

	it("differs from a key derived from another master", () => {
		expect(deriveMediaKey(new Uint8Array(32).fill(9))).not.toEqual(key);
	});
});

describe("sealMedia / openMedia", () => {
	it("round-trips bytes for a domain + filename", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Cover, "abc.png", png);
		expect(isSealedMedia(sealed)).toBe(true);
		expect(openMedia(key, VaultMediaDomain.Cover, "abc.png", sealed)).toEqual(png);
	});

	it("prefixes the magic and grows by magic + nonce + tag", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Icon, "x.png", png);
		expect(sealed.subarray(0, MEDIA_SEAL_MAGIC.length)).toEqual(MEDIA_SEAL_MAGIC);
		expect(sealed.length).toBeGreaterThan(png.length + MEDIA_SEAL_MAGIC.length);
	});

	it("fails to open under a wrong key", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Cover, "abc.png", png);
		expect(() =>
			openMedia(deriveMediaKey(new Uint8Array(32).fill(1)), VaultMediaDomain.Cover, "abc.png", sealed),
		).toThrow();
	});

	it("fails to open under the wrong domain (AAD mismatch)", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Cover, "abc.png", png);
		expect(() => openMedia(key, VaultMediaDomain.Icon, "abc.png", sealed)).toThrow();
	});

	it("fails to open under the wrong filename (AAD mismatch)", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Cover, "abc.png", png);
		expect(() => openMedia(key, VaultMediaDomain.Cover, "other.png", sealed)).toThrow();
	});

	it("fails to open a tampered blob", () => {
		const sealed = sealMedia(key, VaultMediaDomain.Cover, "abc.png", png);
		const last = sealed.length - 1;
		sealed[last] = (sealed[last] ?? 0) ^ 0xff;
		expect(() => openMedia(key, VaultMediaDomain.Cover, "abc.png", sealed)).toThrow();
	});

	it("rejects opening a non-sealed (plaintext) blob", () => {
		expect(() => openMedia(key, VaultMediaDomain.Cover, "abc.png", png)).toThrow();
	});
});

describe("isSealedMedia", () => {
	it("is false for real image magics (PNG/JPEG/GIF/WebP)", () => {
		expect(isSealedMedia(png)).toBe(false);
		expect(isSealedMedia(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false); // JPEG
		expect(isSealedMedia(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(false); // GIF8
		expect(isSealedMedia(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false); // RIFF/WebP
	});

	it("is false for a blob too short to carry the magic", () => {
		expect(isSealedMedia(new Uint8Array([0x42, 0x53]))).toBe(false);
	});
});
