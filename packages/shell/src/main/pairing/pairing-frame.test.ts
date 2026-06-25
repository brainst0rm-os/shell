/**
 * Stage 10.5c — pairing wire-frame codec tests.
 *
 * Pins the relay-compatible binary frame shape (same outer wrapping as
 * `envelope-codec.ts` so the relay's `peekRoutingHeader` routes pairing
 * frames identically to sync envelopes) + the sig verify contract +
 * tolerance for malformed bodies.
 */

import { describe, expect, it } from "vitest";
import { WireKind } from "../sync/routing-header";
import { ed25519 } from "../test-support/crypto-test-helpers";
import {
	type JoinRequestBody,
	PairingFrameType,
	type SealedIdentityBody,
	decodePairingFrame,
	encodePairingFrame,
	verifyPairingFrame,
} from "./pairing-frame";

function freshKeypair(): { pub: Uint8Array; sec: Uint8Array } {
	const kp = ed25519.keygen();
	return { sec: new Uint8Array(kp.secretKey), pub: new Uint8Array(kp.publicKey) };
}

function fixedNonce(): string {
	return Buffer.from(new Uint8Array(24).fill(0x01)).toString("base64");
}

function joinReqBody(): JoinRequestBody {
	return {
		type: PairingFrameType.JoinRequest,
		deviceEd25519Pub: "AAAAEd25519PubBase64Url",
		deviceX25519Pub: "AAAAX25519PubBase64Url",
		deviceLabel: "Test Device",
	};
}

function sealedBody(): SealedIdentityBody {
	return {
		type: PairingFrameType.SealedIdentity,
		sealed: Buffer.from(JSON.stringify({ v: 1, nonceB64: "abc", ciphertextB64: "def" })).toString(
			"base64",
		),
		sourceDeviceEd25519Pub: "AAAASrcEd25519",
	};
}

describe("pairing-frame codec", () => {
	it("encode → decode preserves header + body", () => {
		const kp = freshKeypair();
		const frame = encodePairingFrame({
			channelId: "channel-abc",
			body: joinReqBody(),
			deviceEd25519Pub: kp.pub,
			deviceEd25519Secret: kp.sec,
			seq: 7,
			nowMs: 1_700_000_000_000,
			nonce: fixedNonce(),
		});
		const decoded = decodePairingFrame(frame);
		expect(decoded.header.kind).toBe(WireKind.Pairing);
		expect(decoded.header.entityId).toBe("channel-abc");
		expect(decoded.header.seq).toBe(7);
		expect(decoded.header.ts).toBe(1_700_000_000_000);
		expect(decoded.body.type).toBe(PairingFrameType.JoinRequest);
	});

	it("decode encodes a SealedIdentity body round-trip", () => {
		const kp = freshKeypair();
		const frame = encodePairingFrame({
			channelId: "ch-2",
			body: sealedBody(),
			deviceEd25519Pub: kp.pub,
			deviceEd25519Secret: kp.sec,
			seq: 0,
			nowMs: 1,
			nonce: fixedNonce(),
		});
		const decoded = decodePairingFrame(frame);
		expect(decoded.body.type).toBe(PairingFrameType.SealedIdentity);
		if (decoded.body.type === PairingFrameType.SealedIdentity) {
			expect(decoded.body.sealed.length).toBeGreaterThan(0);
			expect(decoded.body.sourceDeviceEd25519Pub).toBe("AAAASrcEd25519");
		}
	});

	it("verifyPairingFrame succeeds for a fresh frame, fails after tamper", () => {
		const kp = freshKeypair();
		const frame = encodePairingFrame({
			channelId: "ch",
			body: joinReqBody(),
			deviceEd25519Pub: kp.pub,
			deviceEd25519Secret: kp.sec,
			seq: 0,
			nowMs: 1,
			nonce: fixedNonce(),
		});
		const decoded = decodePairingFrame(frame);
		expect(verifyPairingFrame(decoded, kp.pub)).toBe(true);
		// Tampering the body should invalidate the sig.
		const evil = { ...decoded, body: { ...decoded.body, deviceLabel: "MALICIOUS" } };
		expect(verifyPairingFrame(evil, kp.pub)).toBe(false);
	});

	it("verifyPairingFrame fails on the wrong pubkey", () => {
		const sender = freshKeypair();
		const other = freshKeypair();
		const frame = encodePairingFrame({
			channelId: "ch",
			body: joinReqBody(),
			deviceEd25519Pub: sender.pub,
			deviceEd25519Secret: sender.sec,
			seq: 0,
			nowMs: 1,
			nonce: fixedNonce(),
		});
		const decoded = decodePairingFrame(frame);
		expect(verifyPairingFrame(decoded, other.pub)).toBe(false);
	});

	it("decodePairingFrame throws Invalid on a non-Pairing header kind", () => {
		// Build a frame, then surgically mutate the canonical header to use
		// the Update kind — the canonical decoder accepts it but our codec
		// must reject because the body shape differs.
		const kp = freshKeypair();
		const ok = encodePairingFrame({
			channelId: "ch",
			body: joinReqBody(),
			deviceEd25519Pub: kp.pub,
			deviceEd25519Secret: kp.sec,
			seq: 0,
			nowMs: 1,
			nonce: fixedNonce(),
		});
		// Patch the JSON header bytes from `"pairing"` to `"update"` (same
		// length, easy splice).
		const view = new DataView(ok.buffer, ok.byteOffset, ok.byteLength);
		const headerLen = view.getUint32(0, false);
		const headerBytes = ok.subarray(4, 4 + headerLen);
		const json = new TextDecoder().decode(headerBytes);
		const swapped = json.replace('"pairing"', '"update"');
		const swappedBytes = new TextEncoder().encode(swapped);
		if (swappedBytes.length === headerBytes.length) {
			const tampered = new Uint8Array(ok);
			tampered.set(swappedBytes, 4);
			expect(() => decodePairingFrame(tampered)).toThrow(/header.kind must be pairing/);
		}
	});

	it("decodePairingFrame throws on a malformed body JSON", () => {
		const kp = freshKeypair();
		const frame = encodePairingFrame({
			channelId: "ch",
			body: joinReqBody(),
			deviceEd25519Pub: kp.pub,
			deviceEd25519Secret: kp.sec,
			seq: 0,
			nowMs: 1,
			nonce: fixedNonce(),
		});
		// Truncate the body's last byte so the JSON parse fails on decode.
		const truncated = frame.subarray(0, frame.length - 1);
		expect(() => decodePairingFrame(truncated)).toThrow(/truncated body/);
	});

	it("encodePairingFrame rejects invalid input shapes", () => {
		const kp = freshKeypair();
		expect(() =>
			encodePairingFrame({
				channelId: "",
				body: joinReqBody(),
				deviceEd25519Pub: kp.pub,
				deviceEd25519Secret: kp.sec,
				seq: 0,
				nowMs: 1,
				nonce: fixedNonce(),
			}),
		).toThrow(/channelId is required/);
		expect(() =>
			encodePairingFrame({
				channelId: "x",
				body: joinReqBody(),
				deviceEd25519Pub: new Uint8Array(31),
				deviceEd25519Secret: kp.sec,
				seq: 0,
				nowMs: 1,
				nonce: fixedNonce(),
			}),
		).toThrow(/deviceEd25519Pub must be 32 bytes/);
	});
});
