// Crypto primitives used by the spike clients. IMPORTED ONLY BY client.ts.
// relay.ts must never import this file — the blind-relay invariant is
// structural: the relay has no path to any key.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { type RoutingHeader, bytesToSign } from "./wire.ts";

export function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

// ---- Identity / device keys ----

export interface Ed25519KeyPair {
	readonly secret: Uint8Array; // 32-byte seed
	readonly pub: Uint8Array; // 32-byte pubkey
}

export interface X25519KeyPair {
	readonly secret: Uint8Array; // 32-byte
	readonly pub: Uint8Array; // 32-byte
}

export function newEd25519KeyPair(): Ed25519KeyPair {
	const kp = ed25519.keygen();
	return { secret: kp.secretKey, pub: kp.publicKey };
}

export function newX25519KeyPair(): X25519KeyPair {
	const kp = x25519.keygen();
	return { secret: kp.secretKey, pub: kp.publicKey };
}

// ---- Per-entity DEK ----

export function newDek(): Uint8Array {
	return randomBytes(32); // 256-bit
}

// ---- Member-wrap of the DEK under a recipient X25519 pubkey ----
//
// Static-static ECDH wrap for the spike. Real production wraps will
// use an ephemeral sender key (HPKE / ECIES-style); the doc records
// that decision as out-of-scope for the spike — the surface shape
// (24-byte XChaCha nonce + 32-byte authTag-bearing AEAD + a wrap
// per recipient pubkey) is the same.
export interface MemberWrap {
	readonly recipientPub: Uint8Array; // 32-byte X25519 pubkey
	readonly nonce: Uint8Array; // 24-byte
	readonly ciphertext: Uint8Array; // 32+16 = 48 bytes
}

const WRAP_INFO = new TextEncoder().encode("brainstorm/v1/dek-wrap");

export function wrapDekFor(
	dek: Uint8Array,
	senderX25519Secret: Uint8Array,
	recipientX25519Pub: Uint8Array,
): MemberWrap {
	const shared = x25519.getSharedSecret(senderX25519Secret, recipientX25519Pub);
	const wrapKey = hkdf(sha256, shared, undefined, WRAP_INFO, 32);
	const nonce = randomBytes(24);
	const aead = xchacha20poly1305(wrapKey, nonce);
	const ciphertext = aead.encrypt(dek);
	return { recipientPub: recipientX25519Pub, nonce, ciphertext };
}

export function unwrapDek(
	wrap: MemberWrap,
	recipientX25519Secret: Uint8Array,
	senderX25519Pub: Uint8Array,
): Uint8Array {
	const shared = x25519.getSharedSecret(recipientX25519Secret, senderX25519Pub);
	const wrapKey = hkdf(sha256, shared, undefined, WRAP_INFO, 32);
	const aead = xchacha20poly1305(wrapKey, wrap.nonce);
	return aead.decrypt(wrap.ciphertext);
}

// ---- Yjs-update encryption under the DEK ----
//
// XChaCha20-Poly1305 per OQ-25. 24-byte random nonce per envelope is safe
// (RFC draft permits CSPRNG nonces). Returns ciphertext including the 16-byte
// AEAD tag. AAD is the routing header so a relay-rewritten header invalidates
// the AEAD.
export interface EncryptedUpdate {
	readonly nonce: Uint8Array; // 24
	readonly ciphertext: Uint8Array; // plaintext.length + 16
}

export function encryptUpdate(
	dek: Uint8Array,
	plaintext: Uint8Array,
	aad: Uint8Array,
	nonce?: Uint8Array,
): EncryptedUpdate {
	const n = nonce ?? randomBytes(24);
	const aead = xchacha20poly1305(dek, n, aad);
	return { nonce: n, ciphertext: aead.encrypt(plaintext) };
}

export function decryptUpdate(
	dek: Uint8Array,
	encrypted: EncryptedUpdate,
	aad: Uint8Array,
): Uint8Array {
	const aead = xchacha20poly1305(dek, encrypted.nonce, aad);
	return aead.decrypt(encrypted.ciphertext);
}

// ---- Envelope signature (Ed25519 device key) ----

export function signEnvelope(
	ed25519DeviceSecret: Uint8Array,
	header: RoutingHeader,
	ciphertext: Uint8Array,
): Uint8Array {
	const bytes = bytesToSign(header, ciphertext);
	return ed25519.sign(bytes, ed25519DeviceSecret);
}

export function verifyEnvelope(
	sig: Uint8Array,
	header: RoutingHeader,
	ciphertext: Uint8Array,
	ed25519DevicePub: Uint8Array,
): boolean {
	const bytes = bytesToSign(header, ciphertext);
	return ed25519.verify(sig, bytes, ed25519DevicePub);
}

// ---- Add-device record (Ed25519 user identity signs the new device pubkey) ----
//
// Sovereign user identity = an Ed25519 keypair the first device generated.
// When pairing a second device, the existing device signs an `add-device`
// blob `{newDevicePub, addedAt}` under the *user* key. Other devices verify
// against the user key, which they each hold a copy of after pairing.

export interface AddDeviceRecord {
	readonly newDevicePub: Uint8Array;
	readonly newDeviceX25519Pub: Uint8Array;
	readonly addedAt: number;
	readonly sig: Uint8Array; // signed by the user-Ed25519 key
}

export function signAddDevice(
	userEd25519Secret: Uint8Array,
	newDevicePub: Uint8Array,
	newDeviceX25519Pub: Uint8Array,
	addedAt: number,
): AddDeviceRecord {
	const payload = serializeAddDevice(newDevicePub, newDeviceX25519Pub, addedAt);
	const sig = ed25519.sign(payload, userEd25519Secret);
	return { newDevicePub, newDeviceX25519Pub, addedAt, sig };
}

export function verifyAddDevice(record: AddDeviceRecord, userEd25519Pub: Uint8Array): boolean {
	const payload = serializeAddDevice(record.newDevicePub, record.newDeviceX25519Pub, record.addedAt);
	return ed25519.verify(record.sig, payload, userEd25519Pub);
}

function serializeAddDevice(
	newDevicePub: Uint8Array,
	newDeviceX25519Pub: Uint8Array,
	addedAt: number,
): Uint8Array {
	const ts = new TextEncoder().encode(String(addedAt));
	const out = new Uint8Array(newDevicePub.length + newDeviceX25519Pub.length + ts.length);
	out.set(newDevicePub, 0);
	out.set(newDeviceX25519Pub, newDevicePub.length);
	out.set(ts, newDevicePub.length + newDeviceX25519Pub.length);
	return out;
}
