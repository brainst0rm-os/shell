import { describe, expect, it } from "vitest";
import { generateSymmetricKey } from "../credentials/crypto";
import { generateDeviceEd25519 } from "../credentials/device-ed25519";
import { PairingChannelGuard } from "../credentials/identity-export";
import { ed25519 } from "../test-support/crypto-test-helpers";
import {
	PairingState,
	SourcePairingMachine,
	TargetPairingMachine,
	deriveSasMaterial,
	joinQrHandshakeOnTarget,
	newSasEphemeral,
	sealQrIdentityForB,
	startQrHandshakeOnSource,
} from "./pairing-handshake";
import { PairingMode, decodePairingPayload, encodePairingPayload } from "./pairing-payload";

function freshUserIdentity(): { sec: Uint8Array; pub: Uint8Array } {
	const kp = ed25519.keygen();
	return { sec: new Uint8Array(kp.secretKey), pub: new Uint8Array(kp.publicKey) };
}

describe("pairing-handshake — QR happy path", () => {
	it("source generates a payload + SAS + channelId; target decodes + opens sealed identity", () => {
		const identity = freshUserIdentity();
		const sourceDevice = generateDeviceEd25519();
		const start = startQrHandshakeOnSource({
			userEd25519Pub: identity.pub,
			userEd25519Sec: identity.sec,
			sourceDeviceEd25519Pub: sourceDevice.publicKey,
			relayUrl: "wss://relay.example.test/v1",
		});
		expect(start.sas).toMatch(/^\d{6}$/);
		expect(start.payload.length).toBeGreaterThan(0);
		expect(start.pairingSecret.length).toBe(32);
		expect(start.channelId.length).toBeGreaterThan(0);

		const decoded = decodePairingPayload(start.payload);
		expect(decoded.mode).toBe(PairingMode.Qr);
		expect(Buffer.compare(decoded.userEd25519Pub, identity.pub)).toBe(0);

		const sealed = sealQrIdentityForB(identity.sec, start.pairingSecret);
		const guard = new PairingChannelGuard();
		const result = joinQrHandshakeOnTarget({
			encodedPayload: start.payload,
			sealedIdentity: sealed,
			guard,
		});
		expect(Buffer.compare(result.identitySecret, identity.sec)).toBe(0);
		expect(Buffer.compare(result.userEd25519Pub, identity.pub)).toBe(0);
		expect(result.sas).toBe(start.sas);
		expect(result.channelId).toBe(start.channelId);
		expect(result.relayUrl).toBe("wss://relay.example.test/v1");
	});

	it("rejects an expired payload (now >= expiresAt)", () => {
		const identity = freshUserIdentity();
		const sourceDevice = generateDeviceEd25519();
		let frozenNow = 1_000;
		const start = startQrHandshakeOnSource(
			{
				userEd25519Pub: identity.pub,
				userEd25519Sec: identity.sec,
				sourceDeviceEd25519Pub: sourceDevice.publicKey,
				relayUrl: "wss://relay.example.test",
				ttlSeconds: 60,
			},
			{ now: () => frozenNow },
		);
		const sealed = sealQrIdentityForB(identity.sec, start.pairingSecret);
		const guard = new PairingChannelGuard();
		frozenNow = 9_999;
		expect(() =>
			joinQrHandshakeOnTarget(
				{ encodedPayload: start.payload, sealedIdentity: sealed, guard },
				{ now: () => frozenNow },
			),
		).toThrowError(/expired/);
	});

	it("rejects a sealed identity opened with the wrong pairingSecret", () => {
		const identity = freshUserIdentity();
		const sourceDevice = generateDeviceEd25519();
		const start = startQrHandshakeOnSource({
			userEd25519Pub: identity.pub,
			userEd25519Sec: identity.sec,
			sourceDeviceEd25519Pub: sourceDevice.publicKey,
			relayUrl: "wss://relay.example.test/v1",
		});
		const wrongPairingSecret = generateSymmetricKey();
		const sealed = sealQrIdentityForB(identity.sec, wrongPairingSecret);
		const guard = new PairingChannelGuard();
		expect(() =>
			joinQrHandshakeOnTarget({
				encodedPayload: start.payload,
				sealedIdentity: sealed,
				guard,
			}),
		).toThrowError();
	});

	it("rejects a replay (same payload + sealed pair scanned twice)", () => {
		const identity = freshUserIdentity();
		const sourceDevice = generateDeviceEd25519();
		const start = startQrHandshakeOnSource({
			userEd25519Pub: identity.pub,
			userEd25519Sec: identity.sec,
			sourceDeviceEd25519Pub: sourceDevice.publicKey,
			relayUrl: "wss://relay.example.test/v1",
		});
		const sealed = sealQrIdentityForB(identity.sec, start.pairingSecret);
		const guard = new PairingChannelGuard();
		joinQrHandshakeOnTarget({ encodedPayload: start.payload, sealedIdentity: sealed, guard });
		expect(() =>
			joinQrHandshakeOnTarget({
				encodedPayload: start.payload,
				sealedIdentity: sealed,
				guard,
			}),
		).toThrowError(/already consumed/);
	});

	it("rejects a payload whose mode is SAS when joined through the QR path", () => {
		const identity = freshUserIdentity();
		// Manually mint a SAS-mode payload and try to QR-join it.
		const sas = startQrHandshakeOnSource({
			userEd25519Pub: identity.pub,
			userEd25519Sec: identity.sec,
			sourceDeviceEd25519Pub: generateDeviceEd25519().publicKey,
			relayUrl: "wss://relay.example.test/v1",
		});
		// Swap mode byte to SAS via re-encode.
		const decoded = decodePairingPayload(sas.payload);
		const sasEncoded = encodePairingPayload({
			...decoded,
			mode: PairingMode.Sas,
		});
		const sealed = sealQrIdentityForB(identity.sec, sas.pairingSecret);
		const guard = new PairingChannelGuard();
		expect(() =>
			joinQrHandshakeOnTarget({ encodedPayload: sasEncoded, sealedIdentity: sealed, guard }),
		).toThrowError(/mode must be qr/);
	});

	it("rejects a sealed identity whose plaintext doesn't match the payload pubkey", () => {
		const identityA = freshUserIdentity();
		const identityB = freshUserIdentity();
		const start = startQrHandshakeOnSource({
			userEd25519Pub: identityA.pub,
			userEd25519Sec: identityA.sec,
			sourceDeviceEd25519Pub: generateDeviceEd25519().publicKey,
			relayUrl: "wss://relay.example.test/v1",
		});
		// Seal a DIFFERENT identity's secret under the same pairingSecret.
		const sealed = sealQrIdentityForB(identityB.sec, start.pairingSecret);
		const guard = new PairingChannelGuard();
		expect(() =>
			joinQrHandshakeOnTarget({ encodedPayload: start.payload, sealedIdentity: sealed, guard }),
		).toThrowError(/does not match/);
	});
});

describe("pairing-handshake — SAS material derivation", () => {
	it("both devices derive the same pairingSecret + SAS from peer pubkeys", () => {
		const a = newSasEphemeral();
		const b = newSasEphemeral();
		const aDerived = deriveSasMaterial(a.secretKey, b.publicKey);
		const bDerived = deriveSasMaterial(b.secretKey, a.publicKey);
		expect(aDerived.sas).toBe(bDerived.sas);
		expect(Buffer.compare(aDerived.pairingSecret, bDerived.pairingSecret)).toBe(0);
		expect(aDerived.channelId).toBe(bDerived.channelId);
	});

	it("rejects malformed ephemeral byte sizes", () => {
		expect(() => deriveSasMaterial(new Uint8Array(16), new Uint8Array(32))).toThrowError(/ownSecret/);
		expect(() => deriveSasMaterial(new Uint8Array(32), new Uint8Array(16))).toThrowError(
			/peerPublic/,
		);
	});
});

describe("pairing-handshake — state machines", () => {
	it("SourcePairingMachine flows Idle → WaitingForJoin → HandshakeInFlight → Paired", () => {
		const m = new SourcePairingMachine({ requestId: "r1", mode: PairingMode.Qr });
		expect(m.state).toBe(PairingState.Idle);
		m.armedForJoin({ sas: "123456", expiresAt: 100 });
		expect(m.state).toBe(PairingState.WaitingForJoin);
		m.handshakeStarted();
		expect(m.state).toBe(PairingState.HandshakeInFlight);
		m.paired();
		expect(m.state).toBe(PairingState.Paired);
	});

	it("SourcePairingMachine rejects invalid transitions", () => {
		const m = new SourcePairingMachine({ requestId: "r1", mode: PairingMode.Qr });
		m.armedForJoin({ sas: "1", expiresAt: 1 });
		m.handshakeStarted();
		m.paired();
		expect(() => m.cancel()).not.toThrow();
		// Cancel from Paired is a no-op (terminal state). Even cancel-after-paired
		// shouldn't transition.
		expect(m.state).toBe(PairingState.Paired);
	});

	it("TargetPairingMachine flows Idle → HandshakeInFlight → Paired", () => {
		const m = new TargetPairingMachine({ requestId: "r2", mode: PairingMode.Qr });
		m.beginScan({ sas: "123456", expiresAt: 100 });
		expect(m.state).toBe(PairingState.HandshakeInFlight);
		m.paired();
		expect(m.state).toBe(PairingState.Paired);
	});

	it("cancel/expire/fail are valid from non-terminal states", () => {
		const m1 = new SourcePairingMachine({ requestId: "a", mode: PairingMode.Qr });
		m1.cancel();
		expect(m1.state).toBe(PairingState.Cancelled);

		const m2 = new SourcePairingMachine({ requestId: "b", mode: PairingMode.Qr });
		m2.armedForJoin({ sas: "1", expiresAt: 1 });
		m2.expire();
		expect(m2.state).toBe(PairingState.Expired);

		const m3 = new TargetPairingMachine({ requestId: "c", mode: PairingMode.Qr });
		m3.beginScan({ sas: "1", expiresAt: 1 });
		m3.fail("simulated");
		expect(m3.state).toBe(PairingState.Error);
		expect(m3.snapshot().error).toBe("simulated");
	});
});
