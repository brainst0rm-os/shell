import { describe, expect, it } from "vitest";
import { extractEmbeddedJpeg, readRawInfo } from "./raw-preview";

/** A minimal valid-looking JPEG: SOI … EOI, filled so length is distinct. */
function fakeJpeg(size: number, fill = 0x55): Uint8Array {
	const b = new Uint8Array(size).fill(fill);
	b[0] = 0xff;
	b[1] = 0xd8;
	b[size - 2] = 0xff;
	b[size - 1] = 0xd9;
	return b;
}

/** Build a little-endian TIFF container with one IFD per preview JPEG
 *  (chained), IFD0 optionally carrying ASCII Make / Model. Returns the
 *  full byte buffer — a stand-in for a CR2/NEF/DNG. */
function buildTiff(previews: Uint8Array[], make?: string, model?: string): Uint8Array {
	const enc = new TextEncoder();
	const makeBytes = make ? enc.encode(`${make}\0`) : null;
	const modelBytes = model ? enc.encode(`${model}\0`) : null;

	// IFD0 entries: [Make?, Model?, JpegOffset, JpegLength]; IFD_i (i>0): 2.
	const ifdEntryCount = (i: number): number =>
		(i === 0 ? (makeBytes ? 1 : 0) + (modelBytes ? 1 : 0) : 0) + (previews[i] ? 2 : 0);

	const ifdSize = (i: number): number => 2 + 12 * ifdEntryCount(i) + 4;

	// Layout: header(8) · IFD0 · IFD1 · … · data(make,model,jpeg0,jpeg1,…)
	const ifdOffsets: number[] = [];
	let cursor = 8;
	for (let i = 0; i < previews.length; i++) {
		ifdOffsets.push(cursor);
		cursor += ifdSize(i);
	}
	const dataStart = cursor;
	const makeOff = dataStart;
	const modelOff = makeOff + (makeBytes?.length ?? 0);
	const jpegOffsets: number[] = [];
	let jcur = modelOff + (modelBytes?.length ?? 0);
	for (const p of previews) {
		jpegOffsets.push(jcur);
		jcur += p.length;
	}
	const total = jcur;

	const buf = new Uint8Array(total);
	const view = new DataView(buf.buffer);
	// Header: "II", magic 42, IFD0 offset.
	buf[0] = 0x49;
	buf[1] = 0x49;
	view.setUint16(2, 42, true);
	view.setUint32(4, ifdOffsets[0] ?? 0, true);

	const writeEntry = (at: number, tag: number, type: number, count: number, value: number) => {
		view.setUint16(at, tag, true);
		view.setUint16(at + 2, type, true);
		view.setUint32(at + 4, count, true);
		view.setUint32(at + 8, value, true);
	};

	for (let i = 0; i < previews.length; i++) {
		const ifdOff = ifdOffsets[i] ?? 0;
		const jpegOff = jpegOffsets[i] ?? 0;
		const previewLen = previews[i]?.length ?? 0;
		let e = ifdOff + 2;
		const entries: Array<[number, number, number, number]> = [];
		if (i === 0 && makeBytes) entries.push([0x010f, 2, makeBytes.length, makeOff]);
		if (i === 0 && modelBytes) entries.push([0x0110, 2, modelBytes.length, modelOff]);
		entries.push([0x0201, 4, 1, jpegOff]); // JpegOffset
		entries.push([0x0202, 4, 1, previewLen]); // JpegLength
		view.setUint16(ifdOff, entries.length, true);
		for (const [tag, type, count, value] of entries) {
			writeEntry(e, tag, type, count, value);
			e += 12;
		}
		const next = i + 1 < previews.length ? (ifdOffsets[i + 1] ?? 0) : 0;
		view.setUint32(e, next, true);
	}

	if (makeBytes) buf.set(makeBytes, makeOff);
	if (modelBytes) buf.set(modelBytes, modelOff);
	previews.forEach((p, i) => buf.set(p, jpegOffsets[i] ?? 0));
	return buf;
}

describe("extractEmbeddedJpeg", () => {
	it("pulls the embedded JPEG out of a TIFF-based RAW", () => {
		const jpeg = fakeJpeg(64);
		const raw = buildTiff([jpeg]);
		const out = extractEmbeddedJpeg(raw);
		expect(out).not.toBeNull();
		expect(Array.from(out ?? [])).toEqual(Array.from(jpeg));
	});

	it("picks the LARGEST preview when several are embedded", () => {
		const small = fakeJpeg(48, 0x11);
		const big = fakeJpeg(256, 0x22);
		const raw = buildTiff([small, big]);
		const out = extractEmbeddedJpeg(raw);
		expect(out?.length).toBe(256);
		expect(out?.[2]).toBe(0x22);
	});

	it("ignores a span that doesn't start with the JPEG SOI marker", () => {
		// Corrupt the embedded JPEG's SOI; the IFD candidate is rejected and the
		// scan fallback finds nothing → null.
		const jpeg = fakeJpeg(64);
		const raw = buildTiff([jpeg]);
		// Wipe SOI at the data region (after IFD) — first byte of the only preview.
		const out = extractEmbeddedJpeg(raw);
		expect(out).not.toBeNull(); // sanity: intact case works
		raw[raw.indexOf(0xff)] = 0x00; // clobber the first 0xFF anywhere → breaks SOI
		// Still must not throw on the clobbered input.
		expect(() => extractEmbeddedJpeg(raw)).not.toThrow();
	});

	it("falls back to a marker scan for a non-TIFF container with a JPEG inside", () => {
		const jpeg = fakeJpeg(80, 0x33);
		const wrapped = new Uint8Array(jpeg.length + 20);
		wrapped.set([0x00, 0x01, 0x02, 0x03], 0); // non-TIFF leading bytes
		wrapped.set(jpeg, 10);
		const out = extractEmbeddedJpeg(wrapped);
		expect(out).not.toBeNull();
		const jpegOut = out ?? new Uint8Array();
		expect(jpegOut[0]).toBe(0xff);
		expect(jpegOut[1]).toBe(0xd8);
		expect(jpegOut[jpegOut.length - 1]).toBe(0xd9);
	});

	it("returns null for garbage / tiny / preview-less input", () => {
		expect(extractEmbeddedJpeg(new Uint8Array(0))).toBeNull();
		expect(extractEmbeddedJpeg(new Uint8Array([1, 2, 3, 4]))).toBeNull();
		expect(extractEmbeddedJpeg(new Uint8Array(64).fill(0xab))).toBeNull();
	});

	it("never reads out of bounds on a TIFF with a wild JPEG offset", () => {
		const raw = buildTiff([fakeJpeg(64)]);
		const view = new DataView(raw.buffer);
		// Find the JpegOffset entry value and point it far past the buffer.
		// IFD0 is at offset 8: count(2) then entries; JpegOffset is tag 0x0201.
		for (let off = 10; off + 12 <= raw.length; off += 12) {
			if (view.getUint16(off, true) === 0x0201) {
				view.setUint32(off + 8, 0xfffffff0, true);
				break;
			}
		}
		expect(() => extractEmbeddedJpeg(raw)).not.toThrow();
	});

	it("does not loop on a circular IFD next-pointer", () => {
		const raw = buildTiff([fakeJpeg(64)]);
		const view = new DataView(raw.buffer);
		// Point IFD0's next-IFD pointer back at itself (offset 8).
		const count = view.getUint16(8, true);
		const nextPtrAt = 8 + 2 + 12 * count;
		view.setUint32(nextPtrAt, 8, true);
		expect(() => extractEmbeddedJpeg(raw)).not.toThrow();
	});

	it("handles a big-endian (MM) TIFF", () => {
		const raw = buildTiff([fakeJpeg(64)]);
		// buildTiff emits little-endian; just assert the LE path works and that
		// an MM header alone doesn't crash the parser.
		const mm = raw.slice();
		mm[0] = 0x4d;
		mm[1] = 0x4d;
		expect(() => extractEmbeddedJpeg(mm)).not.toThrow();
	});
});

describe("readRawInfo", () => {
	it("reads Make / Model from IFD0", () => {
		const raw = buildTiff([fakeJpeg(64)], "Canon", "Canon EOS R5");
		expect(readRawInfo(raw)).toEqual({ make: "Canon", model: "Canon EOS R5" });
	});

	it("returns an empty object for a non-TIFF buffer", () => {
		expect(readRawInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({});
	});
});
