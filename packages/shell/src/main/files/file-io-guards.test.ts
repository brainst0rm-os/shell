import { describe, expect, it } from "vitest";
import { MAX_WRITE_BYTES, WriteRejectReason, decodeWriteData } from "./file-io-guards";

describe("decodeWriteData — accepted binary shapes", () => {
	it("passes a Uint8Array through by identity", () => {
		const u = new Uint8Array([1, 2, 3]);
		const r = decodeWriteData(u);
		expect(r).toEqual({ ok: true, bytes: u });
		if (r.ok) expect(r.bytes).toBe(u);
	});

	it("accepts a Node Buffer (Uint8Array subclass)", () => {
		const r = decodeWriteData(Buffer.from("hi", "utf8"));
		expect(r.ok).toBe(true);
		if (r.ok) expect([...r.bytes]).toEqual([...Buffer.from("hi")]);
	});

	it("copies an ArrayBuffer into a Uint8Array view", () => {
		const ab = new Uint8Array([9, 8, 7]).buffer;
		const r = decodeWriteData(ab);
		expect(r.ok).toBe(true);
		if (r.ok) expect([...r.bytes]).toEqual([9, 8, 7]);
	});

	it("decodes a { base64 } envelope (round-trips)", () => {
		const original = "hello world";
		const r = decodeWriteData({ base64: Buffer.from(original).toString("base64") });
		expect(r.ok).toBe(true);
		if (r.ok) expect(Buffer.from(r.bytes).toString("utf8")).toBe(original);
	});

	it("treats empty content as a valid (truncate-to-zero) write", () => {
		expect(decodeWriteData(new Uint8Array())).toEqual({ ok: true, bytes: new Uint8Array() });
		const r = decodeWriteData({ base64: "" });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.bytes.byteLength).toBe(0);
	});
});

describe("decodeWriteData — rejections (fail-safe, never throws)", () => {
	it("rejects a bare string / number / null / array / plain object as NotBinary", () => {
		for (const bad of ["raw text", 42, null, undefined, [1, 2], {}, { data: "x" }]) {
			const r = decodeWriteData(bad);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.reason).toBe(WriteRejectReason.NotBinary);
		}
	});

	it("rejects a { base64 } whose value is not a string", () => {
		const r = decodeWriteData({ base64: 123 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe(WriteRejectReason.NotBinary);
	});

	it("rejects over-ceiling payloads (typed array, ArrayBuffer, base64)", () => {
		const big = new Uint8Array(11);
		expect(decodeWriteData(big, 10)).toMatchObject({
			ok: false,
			reason: WriteRejectReason.TooLarge,
		});
		expect(decodeWriteData(new Uint8Array(11).buffer, 10)).toMatchObject({
			ok: false,
			reason: WriteRejectReason.TooLarge,
		});
		expect(decodeWriteData({ base64: Buffer.alloc(11).toString("base64") }, 10)).toMatchObject({
			ok: false,
			reason: WriteRejectReason.TooLarge,
		});
	});

	it("falls back to the default ceiling for a non-finite/negative maxBytes", () => {
		expect(decodeWriteData(new Uint8Array(3), Number.NaN)).toEqual({
			ok: true,
			bytes: new Uint8Array(3),
		});
		expect(MAX_WRITE_BYTES).toBe(256 * 1024 * 1024);
	});
});
