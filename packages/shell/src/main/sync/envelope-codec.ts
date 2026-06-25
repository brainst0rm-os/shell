/**
 * Stage 10.3a — pure wire framing for encrypted envelopes.
 *
 * NO crypto imports — this module is shared by the blind relay and the
 * clients. The relay's "ciphertext-only" property requires that the
 * parsing the relay does here is metadata-only: routing must be possible
 * without ever decrypting. The CI fence in `tools/mcp-server` pins that
 * the relay-port module imports nothing from any crypto library, the seal
 * module, or anything credential-shaped.
 *
 * Frame layout (matches the 10.0 spike's wire so reviewers can diff):
 *
 *   u32-be(headerLen) || canonicalHeaderBytes
 *     || u16-be(sigLen=64) || sig
 *     || u32-be(ctLen) || ciphertext
 *
 * The header bytes are produced by `canonicalizeRoutingHeader`, NOT
 * `JSON.stringify(header)` — every party must compute the AAD over the
 * pinned-order canonical form. `decodeFrame` re-parses the canonical
 * header bytes through `parseRoutingHeaderJson`, which strictly
 * validates shape + protocol version; anything malformed throws
 * `Invalid` (named Error).
 */

import {
	type RoutingHeader,
	canonicalizeRoutingHeader,
	parseRoutingHeaderJson,
} from "./routing-header";

export const ED25519_SIG_BYTES = 64;

export type EncryptedFrame = {
	header: RoutingHeader;
	ciphertext: Uint8Array;
	sig: Uint8Array;
};

export function encodeFrame(frame: EncryptedFrame): Uint8Array {
	const headerBytes = canonicalizeRoutingHeader(frame.header);
	if (frame.sig.length !== ED25519_SIG_BYTES) {
		throw invalid(`encodeFrame: signature must be ${ED25519_SIG_BYTES} bytes`);
	}
	const totalLen = 4 + headerBytes.length + 2 + frame.sig.length + 4 + frame.ciphertext.length;
	const out = new Uint8Array(totalLen);
	const view = new DataView(out.buffer);
	let off = 0;
	view.setUint32(off, headerBytes.length, false);
	off += 4;
	out.set(headerBytes, off);
	off += headerBytes.length;
	view.setUint16(off, frame.sig.length, false);
	off += 2;
	out.set(frame.sig, off);
	off += frame.sig.length;
	view.setUint32(off, frame.ciphertext.length, false);
	off += 4;
	out.set(frame.ciphertext, off);
	return out;
}

export function decodeFrame(bytes: Uint8Array): EncryptedFrame {
	if (bytes.length < 4) throw invalid("decodeFrame: truncated header length");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 0;
	const headerLen = view.getUint32(off, false);
	off += 4;
	if (off + headerLen > bytes.length) throw invalid("decodeFrame: truncated header bytes");
	const headerBytes = bytes.subarray(off, off + headerLen);
	off += headerLen;
	if (off + 2 > bytes.length) throw invalid("decodeFrame: truncated sig length");
	const sigLen = view.getUint16(off, false);
	off += 2;
	if (sigLen !== ED25519_SIG_BYTES)
		throw invalid(`decodeFrame: sig must be ${ED25519_SIG_BYTES} bytes`);
	if (off + sigLen > bytes.length) throw invalid("decodeFrame: truncated sig bytes");
	const sig = bytes.subarray(off, off + sigLen);
	off += sigLen;
	if (off + 4 > bytes.length) throw invalid("decodeFrame: truncated ciphertext length");
	const cipherLen = view.getUint32(off, false);
	off += 4;
	if (off + cipherLen > bytes.length) throw invalid("decodeFrame: truncated ciphertext bytes");
	const ciphertext = bytes.subarray(off, off + cipherLen);
	if (off + cipherLen !== bytes.length)
		throw invalid("decodeFrame: trailing bytes after ciphertext");
	const header = parseRoutingHeaderJson(headerBytes);
	return {
		header,
		ciphertext: new Uint8Array(ciphertext),
		sig: new Uint8Array(sig),
	};
}

function invalid(message: string): Error {
	const err = new Error(message);
	err.name = "Invalid";
	return err;
}
