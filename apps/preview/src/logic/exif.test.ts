import { describe, expect, it } from "vitest";
import { type ExifData, formatExifPairs, parseExif } from "./exif";

/**
 * Builds a minimal but spec-valid JPEG carrying an APP1/Exif block:
 * little-endian TIFF, IFD0 with Orientation=6 + Make="ABC" + an
 * Exif-sub-IFD pointer, and the sub-IFD carrying FNumber=2.8 (rational).
 */
function buildExifJpeg(): Uint8Array {
	// TIFF block, offsets relative to tiffStart.
	const tiff = new Uint8Array(76);
	const dv = new DataView(tiff.buffer);
	// Header: 'II', 0x002A, IFD0 @ 8.
	tiff[0] = 0x49;
	tiff[1] = 0x49;
	dv.setUint16(2, 0x002a, true);
	dv.setUint32(4, 8, true);
	// IFD0 @ 8: 3 entries.
	dv.setUint16(8, 3, true);
	// entry0 Orientation (0x0112) SHORT count 1 value 6
	dv.setUint16(10, 0x0112, true);
	dv.setUint16(12, 3, true);
	dv.setUint32(14, 1, true);
	dv.setUint16(18, 6, true);
	// entry1 Make (0x010F) ASCII count 4 inline "ABC\0"
	dv.setUint16(22, 0x010f, true);
	dv.setUint16(24, 2, true);
	dv.setUint32(26, 4, true);
	tiff[30] = 0x41; // A
	tiff[31] = 0x42; // B
	tiff[32] = 0x43; // C
	tiff[33] = 0x00;
	// entry2 ExifIFDPointer (0x8769) LONG count 1 → sub-IFD @ 50
	dv.setUint16(34, 0x8769, true);
	dv.setUint16(36, 4, true);
	dv.setUint32(38, 1, true);
	dv.setUint32(42, 50, true);
	// next-IFD offset
	dv.setUint32(46, 0, true);
	// Exif sub-IFD @ 50: 1 entry.
	dv.setUint16(50, 1, true);
	// FNumber (0x829D) RATIONAL count 1 → rational @ 68
	dv.setUint16(52, 0x829d, true);
	dv.setUint16(54, 5, true);
	dv.setUint32(56, 1, true);
	dv.setUint32(60, 68, true);
	dv.setUint32(64, 0, true);
	// rational @ 68: 28/10 = 2.8
	dv.setUint32(68, 28, true);
	dv.setUint32(72, 10, true);

	const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
	const app1Len = 2 + exifHeader.length + tiff.length; // length field counts itself
	const out = new Uint8Array(2 + 2 + 2 + exifHeader.length + tiff.length + 2);
	let p = 0;
	out[p++] = 0xff;
	out[p++] = 0xd8; // SOI
	out[p++] = 0xff;
	out[p++] = 0xe1; // APP1
	out[p++] = (app1Len >> 8) & 0xff; // length big-endian
	out[p++] = app1Len & 0xff;
	for (const b of exifHeader) out[p++] = b;
	out.set(tiff, p);
	p += tiff.length;
	out[p++] = 0xff;
	out[p++] = 0xd9; // EOI
	return out;
}

describe("parseExif", () => {
	it("parses orientation, make, and a sub-IFD rational", () => {
		const exif = parseExif(buildExifJpeg());
		expect(exif.orientation).toBe(6);
		expect(exif.make).toBe("ABC");
		expect(exif.fNumber).toBeCloseTo(2.8);
	});

	it("returns {} for a non-JPEG buffer", () => {
		expect(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({});
	});

	it("returns {} for a too-short buffer", () => {
		expect(parseExif(new Uint8Array([0xff]))).toEqual({});
	});

	it("returns {} for a JPEG with no APP1 Exif segment", () => {
		// SOI then SOS marker straight away — parser bails at SOS.
		expect(parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toEqual({});
	});

	it("does not throw on a truncated Exif block", () => {
		const full = buildExifJpeg();
		const truncated = full.slice(0, 30);
		expect(() => parseExif(truncated)).not.toThrow();
		expect(parseExif(truncated)).toEqual({});
	});

	it("rejects an out-of-range orientation", () => {
		const j = buildExifJpeg();
		// Orientation value lives at TIFF offset 18 → buffer offset 12+18 = 30.
		j[30] = 99;
		expect(parseExif(j).orientation).toBeUndefined();
	});
});

describe("formatExifPairs", () => {
	it("emits only present fields, in display order", () => {
		const exif: ExifData = {
			make: "FUJIFILM",
			model: "X100V",
			dateTimeOriginal: "2026:05:15 09:30:00",
			exposureTime: 1 / 250,
			fNumber: 2,
			iso: 400,
			focalLength: 23,
			orientation: 6,
		};
		const pairs = formatExifPairs(exif);
		const labels = pairs.map((p) => p[0]);
		expect(labels).toEqual([
			"Camera",
			"Taken",
			"Exposure",
			"Aperture",
			"ISO",
			"Focal length",
			"Orientation",
		]);
		expect(pairs.find((p) => p[0] === "Exposure")?.[1]).toBe("1/250 s");
		expect(pairs.find((p) => p[0] === "Aperture")?.[1]).toBe("ƒ/2");
		expect(pairs.find((p) => p[0] === "Focal length")?.[1]).toBe("23 mm");
		expect(pairs.find((p) => p[0] === "Orientation")?.[1]).toBe("Rotated 90° CW");
	});

	it("dedupes a make-prefixed model", () => {
		const pairs = formatExifPairs({ make: "NIKON", model: "NIKON D750" });
		expect(pairs.find((p) => p[0] === "Camera")?.[1]).toBe("NIKON D750");
	});

	it("omits the Camera row when neither make nor model is set", () => {
		expect(formatExifPairs({ iso: 100 }).some((p) => p[0] === "Camera")).toBe(false);
	});

	it("omits the Orientation row for a normal orientation", () => {
		expect(formatExifPairs({ orientation: 1 }).some((p) => p[0] === "Orientation")).toBe(false);
	});

	it("formats a slow (≥1s) exposure with seconds", () => {
		expect(formatExifPairs({ exposureTime: 2 }).find((p) => p[0] === "Exposure")?.[1]).toBe("2 s");
	});

	it("returns an empty list for empty EXIF", () => {
		expect(formatExifPairs({})).toEqual([]);
	});

	it("describes a rotated orientation in words for the inspector", () => {
		expect(formatExifPairs({ orientation: 6 }).find((p) => p[0] === "Orientation")?.[1]).toBe(
			"Rotated 90° CW",
		);
		expect(formatExifPairs({ orientation: 8 }).find((p) => p[0] === "Orientation")?.[1]).toBe(
			"Rotated 90° CCW",
		);
	});
});
