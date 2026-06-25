import { describe, expect, it } from "vitest";
import { ED25519_SIG_BYTES, type EncryptedFrame, decodeFrame, encodeFrame } from "./envelope-codec";
import {
	PROTOCOL_VERSION,
	type RoutingHeader,
	WireKind,
	canonicalizeRoutingHeader,
} from "./routing-header";

const header = (): RoutingHeader => ({
	v: PROTOCOL_VERSION,
	kind: WireKind.Update,
	entityId: "ent_codec",
	sender: "sender-b64url",
	seq: 7,
	nonce: "nonce24",
	ts: 1700000000000,
});

const sampleFrame = (overrides: Partial<EncryptedFrame> = {}): EncryptedFrame => ({
	header: header(),
	ciphertext: new Uint8Array([1, 2, 3, 4]),
	sig: new Uint8Array(ED25519_SIG_BYTES),
	...overrides,
});

describe("encode/decodeFrame", () => {
	it("round-trips a kind=Update frame", () => {
		const frame = sampleFrame();
		const decoded = decodeFrame(encodeFrame(frame));
		expect(decoded.header).toEqual(frame.header);
		expect(Array.from(decoded.ciphertext)).toEqual([1, 2, 3, 4]);
		expect(decoded.sig.length).toBe(ED25519_SIG_BYTES);
	});

	it("zero-length ciphertext round-trips", () => {
		const frame = sampleFrame({ ciphertext: new Uint8Array(0) });
		const decoded = decodeFrame(encodeFrame(frame));
		expect(decoded.ciphertext.length).toBe(0);
	});

	it("rejects truncated header", () => {
		const bytes = encodeFrame(sampleFrame());
		expect(() => decodeFrame(bytes.subarray(0, 2))).toThrow(/truncated header/);
	});

	it("rejects truncated sig", () => {
		const bytes = encodeFrame(sampleFrame());
		// Trim mid-sig — after header (~120 bytes) but before sig fully read.
		expect(() => decodeFrame(bytes.subarray(0, bytes.length - 70))).toThrow(/truncated/);
	});

	it("rejects truncated ciphertext", () => {
		const bytes = encodeFrame(sampleFrame());
		expect(() => decodeFrame(bytes.subarray(0, bytes.length - 2))).toThrow(/truncated/);
	});

	it("rejects a snapshot-kind frame at decode (10.3a only wires Update)", () => {
		// Although decode itself doesn't reject `Snapshot` kind (the enum
		// is forward-declared so 10.3b can use it), pushing a non-enum kind
		// like "rotation" is rejected — pin this for the test asserting the
		// 10.3a wire kind set is exactly the enum.
		const bytes = encodeFrame(sampleFrame({ header: { ...header(), kind: WireKind.Snapshot } }));
		const decoded = decodeFrame(bytes);
		expect(decoded.header.kind).toBe(WireKind.Snapshot);
	});

	it("re-encoding the decoded frame produces identical canonical header bytes", () => {
		const frame = sampleFrame();
		const a = encodeFrame(frame);
		const decoded = decodeFrame(a);
		const b = encodeFrame(decoded);
		expect(a).toEqual(b);
		// And the canonical header bytes embedded in the frame match what
		// `canonicalizeRoutingHeader` produces.
		const view = new DataView(a.buffer, a.byteOffset, a.byteLength);
		const headerLen = view.getUint32(0, false);
		const embedded = a.subarray(4, 4 + headerLen);
		expect(embedded).toEqual(canonicalizeRoutingHeader(frame.header));
	});

	it("rejects a frame encoded with a wrong-size signature", () => {
		const bad: EncryptedFrame = {
			header: header(),
			ciphertext: new Uint8Array(2),
			sig: new Uint8Array(32),
		};
		expect(() => encodeFrame(bad)).toThrow(/signature must be 64 bytes/);
	});

	it("rejects trailing bytes after the ciphertext", () => {
		const bytes = encodeFrame(sampleFrame());
		const withTrailer = new Uint8Array(bytes.length + 3);
		withTrailer.set(bytes, 0);
		expect(() => decodeFrame(withTrailer)).toThrow(/trailing bytes/);
	});
});
