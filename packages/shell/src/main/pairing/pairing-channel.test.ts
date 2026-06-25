import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url, pairingChannelId } from "./pairing-channel";

describe("pairingChannelId", () => {
	it("derives the same channel id from the same pairingSecret", () => {
		const secret = new Uint8Array(32).fill(0x42);
		expect(pairingChannelId(secret)).toBe(pairingChannelId(secret));
	});

	it("derives different channel ids for different secrets (collision sanity)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const secret = new Uint8Array(32).fill(i);
			seen.add(pairingChannelId(secret));
		}
		expect(seen.size).toBe(200);
	});

	it("rejects wrong-size pairingSecret", () => {
		expect(() => pairingChannelId(new Uint8Array(16))).toThrowError(/32/);
		expect(() => pairingChannelId(new Uint8Array(64))).toThrowError(/32/);
	});

	it("base64url round-trips bytes losslessly", () => {
		for (const length of [0, 1, 16, 32, 64, 256]) {
			const bytes = new Uint8Array(length);
			for (let i = 0; i < length; i++) bytes[i] = (i * 13) & 0xff;
			const encoded = bytesToBase64Url(bytes);
			expect(encoded).not.toMatch(/[+/=]/);
			const decoded = base64UrlToBytes(encoded);
			expect(Buffer.compare(decoded, bytes)).toBe(0);
		}
	});
});
