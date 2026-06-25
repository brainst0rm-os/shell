/**
 * Stage 10.6 — `sealAwarenessEnvelope` / `openAwarenessEnvelope` unit tests.
 *
 * Mirrors `envelope-seal.test.ts` shape — the awareness path shares the
 * AEAD primitive, AAD-binding, sig order, and `EntityIdMismatch` early-out
 * with `openUpdateEnvelope`, but adds explicit `kind === Awareness` guards
 * on both seal and open (mirroring the WrapBootstrap kind guard).
 */

import { describe, expect, it, vi } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { Doc } from "yjs";
import { XCHACHA_NONCE_BYTES, bytesToBase64, generateSymmetricKey } from "../credentials/crypto";
import { ed25519 } from "../test-support/crypto-test-helpers";
import { EntityIdMismatch, openAwarenessEnvelope, sealAwarenessEnvelope } from "./envelope-seal";
import { PROTOCOL_VERSION, type RoutingHeader, WireKind } from "./routing-header";

function makeDevice() {
	const pair = ed25519.keygen();
	const secret = new Uint8Array(pair.secretKey);
	const pub = new Uint8Array(pair.publicKey);
	const sign = (bytes: Uint8Array): Uint8Array => new Uint8Array(ed25519.sign(bytes, secret));
	const verify = (sig: Uint8Array, bytes: Uint8Array): boolean => {
		try {
			return ed25519.verify(sig, bytes, pub);
		} catch {
			return false;
		}
	};
	return { secret, pub, sign, verify };
}

function freshNonceB64(): string {
	const n = new Uint8Array(XCHACHA_NONCE_BYTES);
	crypto.getRandomValues(n);
	return bytesToBase64(n);
}

const header = (overrides: Partial<RoutingHeader> = {}): RoutingHeader => ({
	v: PROTOCOL_VERSION,
	kind: WireKind.Awareness,
	entityId: "ent_aware",
	sender: "sender-b64",
	seq: 0,
	nonce: freshNonceB64(),
	ts: 1700000000000,
	...overrides,
});

function awarenessUpdateBytes(): { update: Uint8Array; awareness: Awareness } {
	const doc = new Doc();
	const awareness = new Awareness(doc);
	awareness.setLocalState({ cursor: { line: 3, col: 7 }, user: "alice" });
	const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
	return { update, awareness };
}

describe("sealAwarenessEnvelope / openAwarenessEnvelope", () => {
	it("seal/open round-trip yields the original awareness-update bytes verbatim", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const frame = sealAwarenessEnvelope({
			dek,
			header: header(),
			payload: update,
			sign: d.sign,
		});
		const out = openAwarenessEnvelope({
			frame,
			dek,
			resolvedEntityId: frame.header.entityId,
			verify: d.verify,
		});
		expect(out).toEqual(update);
	});

	it("seal refuses a non-Awareness header kind (Update / WrapBootstrap / Pairing)", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		for (const wrongKind of [WireKind.Update, WireKind.WrapBootstrap, WireKind.Pairing]) {
			expect(() =>
				sealAwarenessEnvelope({
					dek,
					header: header({ kind: wrongKind }),
					payload: update,
					sign: d.sign,
				}),
			).toThrow(/awareness/);
		}
	});

	it("open refuses a non-Awareness header (caller cannot route Update through this path)", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const frame = sealAwarenessEnvelope({
			dek,
			header: header(),
			payload: update,
			sign: d.sign,
		});
		const swapped = { ...frame, header: { ...frame.header, kind: WireKind.Update } };
		expect(() =>
			openAwarenessEnvelope({
				frame: swapped,
				dek,
				resolvedEntityId: swapped.header.entityId,
				verify: vi.fn(() => true),
			}),
		).toThrow(/awareness/);
	});

	it("EntityIdMismatch is thrown BEFORE verify when routed id != resolved id", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const frame = sealAwarenessEnvelope({
			dek,
			header: header({ entityId: "ent_routed" }),
			payload: update,
			sign: d.sign,
		});
		const verifySpy = vi.fn(() => true);
		expect(() =>
			openAwarenessEnvelope({
				frame,
				dek,
				resolvedEntityId: "ent_resolved",
				verify: verifySpy,
			}),
		).toThrow(EntityIdMismatch);
		expect(verifySpy).not.toHaveBeenCalled();
	});

	it("flipped sig fails verify BEFORE AEAD is invoked (dek would never be read)", () => {
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const dek = generateSymmetricKey();
		const frame = sealAwarenessEnvelope({
			dek,
			header: header(),
			payload: update,
			sign: d.sign,
		});
		const badSig = new Uint8Array(frame.sig);
		badSig[0] = (badSig[0] ?? 0) ^ 0xff;
		const verifySpy = vi.fn(() => false);
		// Wrap the DEK in a Proxy that throws on any access so the test
		// fails LOUDLY if AEAD-open is ever reached after sig-failure.
		const dekTrap = new Proxy(dek, {
			get(target, prop) {
				if (prop === "length") return target.length;
				if (prop === "constructor") return Uint8Array;
				if (prop === Symbol.toPrimitive) return target[Symbol.toPrimitive as never];
				if (prop === "BYTES_PER_ELEMENT") return target.BYTES_PER_ELEMENT;
				throw new Error(`dek accessed after sig-failure: ${String(prop)}`);
			},
		}) as Uint8Array;
		expect(() =>
			openAwarenessEnvelope({
				frame: { ...frame, sig: badSig },
				dek: dekTrap,
				resolvedEntityId: frame.header.entityId,
				verify: verifySpy,
			}),
		).toThrow(/signature/);
		expect(verifySpy).toHaveBeenCalledOnce();
	});

	it("seal + open reject a nonce that's not 24 bytes", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const shortNonce = new Uint8Array(XCHACHA_NONCE_BYTES - 1);
		crypto.getRandomValues(shortNonce);
		expect(() =>
			sealAwarenessEnvelope({
				dek,
				header: header({ nonce: bytesToBase64(shortNonce) }),
				payload: update,
				sign: d.sign,
			}),
		).toThrow(/24/);
	});

	it("AAD-pin: mutating the header after seal breaks open (AEAD AAD mismatch)", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const { update } = awarenessUpdateBytes();
		const frame = sealAwarenessEnvelope({
			dek,
			header: header({ seq: 0 }),
			payload: update,
			sign: d.sign,
		});
		const swapped = { ...frame, header: { ...frame.header, seq: 99 } };
		const verifyAlways = vi.fn(() => true);
		expect(() =>
			openAwarenessEnvelope({
				frame: swapped,
				dek,
				resolvedEntityId: swapped.header.entityId,
				verify: verifyAlways,
			}),
		).toThrow();
	});

	it("empty payload is allowed (e.g. dispose-broadcasts a null-state update)", () => {
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const empty = new Uint8Array(0);
		const frame = sealAwarenessEnvelope({
			dek,
			header: header(),
			payload: empty,
			sign: d.sign,
		});
		const out = openAwarenessEnvelope({
			frame,
			dek,
			resolvedEntityId: frame.header.entityId,
			verify: d.verify,
		});
		expect(out).toEqual(empty);
	});

	it("a frame claiming kind=Awareness but with bogus inner bytes opens at the seal layer (downstream y-protocols parses)", () => {
		// The seal layer guards crypto invariants; what's inside the
		// plaintext is the y-protocols parser's concern. A garbage payload
		// must still seal+open round-trip — the AEAD doesn't know awareness.
		const dek = generateSymmetricKey();
		const d = makeDevice();
		const bogus = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);
		const frame = sealAwarenessEnvelope({
			dek,
			header: header(),
			payload: bogus,
			sign: d.sign,
		});
		const out = openAwarenessEnvelope({
			frame,
			dek,
			resolvedEntityId: frame.header.entityId,
			verify: d.verify,
		});
		expect(out).toEqual(bogus);
	});
});
