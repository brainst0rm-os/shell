// Pure wire framing for the spike. NO crypto imports — this module is shared
// by the blind relay and the clients. The relay's "ciphertext-only" property
// requires that the parsing the relay does here is metadata-only: it MUST be
// possible to route an envelope without ever decrypting it.

export const PROTOCOL_VERSION = 1;

// Routing-only header the relay reads. Anything not in this shape is opaque
// to the relay. The header is small, fixed-layout, and (for v1's threat
// model) effectively visible to the relay. The proof doc enumerates what
// that visibility leaks; this file does not minimise it because the goal
// of the spike is to characterise the leakage, not pre-emptively obfuscate it.
export type WireKind =
	| "snapshot" // peer-to-peer hand-off of the encrypted Yjs state vector + state
	| "update" // single encrypted Yjs update
	| "awareness" // encrypted awareness ping (transient)
	| "wrap" // a new member-wrap attached to an entity (signed access grant)
	| "rotation"; // a key-rotation record signed by an admin device (sketched)

export interface RoutingHeader {
	readonly v: number; // PROTOCOL_VERSION
	readonly kind: WireKind;
	readonly entityId: string; // opaque to the relay; relay routes on this id
	readonly sender: string; // base64url-encoded sender device pubkey (Ed25519)
	readonly seq: number; // monotonic per-sender; for replay-detection by recipient
	readonly nonce: string; // base64url-encoded 24-byte XChaCha20 nonce
	readonly ts: number; // wall-clock millis; recipient anti-replay window
}

// An on-wire envelope as the relay sees it. `header` is routing metadata,
// `ciphertext` is opaque bytes (AEAD output), `sig` is an Ed25519 signature
// over `header || ciphertext` so the relay can drop forged messages cheaply
// without ever decrypting them.
export interface Envelope {
	readonly header: RoutingHeader;
	readonly ciphertext: Uint8Array;
	readonly sig: Uint8Array; // 64-byte Ed25519 signature
}

export function encodeFrame(env: Envelope): Uint8Array {
	const headerJson = JSON.stringify(env.header);
	const headerBytes = new TextEncoder().encode(headerJson);
	// 4-byte header length, header bytes, 2-byte sig length (always 64),
	// sig bytes, 4-byte ciphertext length, ciphertext bytes. Big-endian.
	const totalLen = 4 + headerBytes.length + 2 + env.sig.length + 4 + env.ciphertext.length;
	const out = new Uint8Array(totalLen);
	const view = new DataView(out.buffer);
	let off = 0;
	view.setUint32(off, headerBytes.length, false);
	off += 4;
	out.set(headerBytes, off);
	off += headerBytes.length;
	view.setUint16(off, env.sig.length, false);
	off += 2;
	out.set(env.sig, off);
	off += env.sig.length;
	view.setUint32(off, env.ciphertext.length, false);
	off += 4;
	out.set(env.ciphertext, off);
	return out;
}

export function decodeFrame(bytes: Uint8Array): Envelope {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 0;
	const headerLen = view.getUint32(off, false);
	off += 4;
	const headerJson = new TextDecoder().decode(bytes.subarray(off, off + headerLen));
	off += headerLen;
	const sigLen = view.getUint16(off, false);
	off += 2;
	const sig = bytes.subarray(off, off + sigLen);
	off += sigLen;
	const cipherLen = view.getUint32(off, false);
	off += 4;
	const ciphertext = bytes.subarray(off, off + cipherLen);
	const header = JSON.parse(headerJson) as RoutingHeader;
	return { header, ciphertext, sig };
}

// Used by the recipient to recover the bytes the sender signed over.
export function bytesToSign(header: RoutingHeader, ciphertext: Uint8Array): Uint8Array {
	const headerBytes = new TextEncoder().encode(JSON.stringify(header));
	const out = new Uint8Array(headerBytes.length + ciphertext.length);
	out.set(headerBytes, 0);
	out.set(ciphertext, headerBytes.length);
	return out;
}

// Helper used only by the proof transcript. The relay calls this to log
// every byte it saw; it does NOT call decodeFrame because the relay would
// not, in production, need to parse anything except the bare routing header.
export function summariseFrame(frame: Uint8Array): {
	totalBytes: number;
	headerJson: string;
	sigLen: number;
	cipherLen: number;
	hexPrefix: string;
} {
	const env = decodeFrame(frame);
	return {
		totalBytes: frame.byteLength,
		headerJson: JSON.stringify(env.header),
		sigLen: env.sig.byteLength,
		cipherLen: env.ciphertext.byteLength,
		hexPrefix: bytesToHex(frame.subarray(0, Math.min(48, frame.byteLength))),
	};
}

export function bytesToHex(b: Uint8Array): string {
	let s = "";
	for (const byte of b) {
		s += byte.toString(16).padStart(2, "0");
	}
	return s;
}

export function bytesToBase64Url(b: Uint8Array): string {
	// Avoid Node Buffer to keep this file dep-free.
	let bin = "";
	for (const byte of b) bin += String.fromCharCode(byte);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
