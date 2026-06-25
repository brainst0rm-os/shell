/**
 * Minimal EXIF reader — 9.20.2.
 *
 * Parses the JPEG APP1 / TIFF block for the handful of tags the inspector
 * surfaces (camera, lens settings, capture time) plus the orientation flag
 * the renderer applies so a portrait photo isn't shown sideways. Pure +
 * bounds-checked: every offset is validated against the buffer length, the
 * IFD walk is entry-capped, and any malformed structure degrades to an
 * empty result rather than throwing — a corrupt photo must never wedge the
 * previewer.
 *
 * Scope: JPEG (`FFD8` … `FFE1` "Exif\0\0" … TIFF). PNG / GIF / WebP / SVG
 * carry no EXIF and return `{}`. TIFF-native files and XMP/IPTC are out of
 * scope for v1 (the inspector still shows dimensions for those via the
 * renderer's decode pass).
 */

export type ExifData = {
	/** 1–8 per the TIFF spec; drives the display transform. */
	orientation?: number;
	make?: string;
	model?: string;
	lensModel?: string;
	dateTimeOriginal?: string;
	exposureTime?: number;
	fNumber?: number;
	iso?: number;
	focalLength?: number;
	pixelXDimension?: number;
	pixelYDimension?: number;
};

const TAG = {
	Make: 0x010f,
	Model: 0x0110,
	Orientation: 0x0112,
	DateTime: 0x0132,
	ExifIFDPointer: 0x8769,
	ExposureTime: 0x829a,
	FNumber: 0x829d,
	ISO: 0x8827,
	DateTimeOriginal: 0x9003,
	FocalLength: 0x920a,
	LensModel: 0xa434,
	PixelXDimension: 0xa002,
	PixelYDimension: 0xa003,
} as const;

const MAX_IFD_ENTRIES = 256;

/** Parse EXIF from a JPEG byte buffer. Returns `{}` for non-JPEG input
 *  or any structural problem. */
export function parseExif(bytes: Uint8Array): ExifData {
	try {
		return parseExifUnsafe(bytes);
	} catch {
		return {};
	}
}

function parseExifUnsafe(bytes: Uint8Array): ExifData {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// Walk JPEG markers looking for APP1 (FFE1) carrying an Exif header.
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (view.getUint8(offset) !== 0xff) break;
		const marker = view.getUint8(offset + 1);
		// SOS (FFDA) — image data begins; no metadata past here.
		if (marker === 0xda) break;
		const segLength = view.getUint16(offset + 2, false);
		if (segLength < 2) break;
		const segStart = offset + 4;
		if (marker === 0xe1 && segStart + 6 <= bytes.length) {
			if (
				bytes[segStart] === 0x45 && // 'E'
				bytes[segStart + 1] === 0x78 && // 'x'
				bytes[segStart + 2] === 0x69 && // 'i'
				bytes[segStart + 3] === 0x66 && // 'f'
				bytes[segStart + 4] === 0x00 &&
				bytes[segStart + 5] === 0x00
			) {
				return parseTiff(view, bytes.length, segStart + 6);
			}
		}
		offset += 2 + segLength;
	}
	return {};
}

function parseTiff(view: DataView, total: number, tiffStart: number): ExifData {
	if (tiffStart + 8 > total) return {};
	const byteOrder = view.getUint16(tiffStart, false);
	const little = byteOrder === 0x4949; // 'II'
	const big = byteOrder === 0x4d4d; // 'MM'
	if (!little && !big) return {};
	const le = little;
	if (view.getUint16(tiffStart + 2, le) !== 0x002a) return {};
	const ifd0 = tiffStart + view.getUint32(tiffStart + 4, le);
	if (ifd0 + 2 > total || ifd0 < tiffStart) return {};

	const out: ExifData = {};
	readIfd(view, total, tiffStart, ifd0, le, out, false);
	return out;
}

function readIfd(
	view: DataView,
	total: number,
	tiffStart: number,
	ifdStart: number,
	le: boolean,
	out: ExifData,
	isExifSub: boolean,
): void {
	if (ifdStart + 2 > total) return;
	const count = view.getUint16(ifdStart, le);
	if (count > MAX_IFD_ENTRIES) return;
	let exifPointer = 0;

	for (let i = 0; i < count; i++) {
		const entry = ifdStart + 2 + i * 12;
		if (entry + 12 > total) return;
		const tag = view.getUint16(entry, le);
		const type = view.getUint16(entry + 2, le);
		const valueCount = view.getUint32(entry + 4, le);

		if (tag === TAG.ExifIFDPointer && !isExifSub) {
			exifPointer = tiffStart + view.getUint32(entry + 8, le);
			continue;
		}

		switch (tag) {
			case TAG.Orientation:
				assignDefined(out, "orientation", clampOrientation(readShort(view, entry, le)));
				break;
			case TAG.Make:
				assignDefined(out, "make", readAscii(view, total, tiffStart, entry, type, valueCount, le));
				break;
			case TAG.Model:
				assignDefined(out, "model", readAscii(view, total, tiffStart, entry, type, valueCount, le));
				break;
			case TAG.LensModel:
				assignDefined(out, "lensModel", readAscii(view, total, tiffStart, entry, type, valueCount, le));
				break;
			case TAG.DateTimeOriginal:
			case TAG.DateTime:
				if (out.dateTimeOriginal === undefined) {
					assignDefined(
						out,
						"dateTimeOriginal",
						readAscii(view, total, tiffStart, entry, type, valueCount, le),
					);
				}
				break;
			case TAG.ExposureTime:
				assignDefined(out, "exposureTime", readRational(view, total, tiffStart, entry, le));
				break;
			case TAG.FNumber:
				assignDefined(out, "fNumber", readRational(view, total, tiffStart, entry, le));
				break;
			case TAG.ISO:
				out.iso = readShort(view, entry, le);
				break;
			case TAG.FocalLength:
				assignDefined(out, "focalLength", readRational(view, total, tiffStart, entry, le));
				break;
			case TAG.PixelXDimension:
				out.pixelXDimension = readLongOrShort(view, entry, type, le);
				break;
			case TAG.PixelYDimension:
				out.pixelYDimension = readLongOrShort(view, entry, type, le);
				break;
			default:
				break;
		}
	}

	if (exifPointer && exifPointer + 2 <= total && exifPointer >= tiffStart) {
		readIfd(view, total, tiffStart, exifPointer, le, out, true);
	}
}

function assignDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
	if (value !== undefined) target[key] = value;
}

function clampOrientation(v: number | undefined): number | undefined {
	if (v === undefined || v < 1 || v > 8) return undefined;
	return v;
}

function readShort(view: DataView, entry: number, le: boolean): number {
	return view.getUint16(entry + 8, le);
}

function readLongOrShort(view: DataView, entry: number, type: number, le: boolean): number {
	return type === 3 ? view.getUint16(entry + 8, le) : view.getUint32(entry + 8, le);
}

function readRational(
	view: DataView,
	total: number,
	tiffStart: number,
	entry: number,
	le: boolean,
): number | undefined {
	const ptr = tiffStart + view.getUint32(entry + 8, le);
	if (ptr + 8 > total || ptr < tiffStart) return undefined;
	const num = view.getUint32(ptr, le);
	const den = view.getUint32(ptr + 4, le);
	if (den === 0) return undefined;
	return num / den;
}

function readAscii(
	view: DataView,
	total: number,
	tiffStart: number,
	entry: number,
	type: number,
	valueCount: number,
	le: boolean,
): string | undefined {
	if (type !== 2 || valueCount === 0) return undefined;
	// ≤4 bytes are stored inline in the value field; longer strings are at
	// an offset.
	const at = valueCount <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, le);
	if (at < 0 || at + valueCount > total) return undefined;
	let s = "";
	for (let i = 0; i < valueCount; i++) {
		const c = view.getUint8(at + i);
		if (c === 0) break;
		s += String.fromCharCode(c);
	}
	const trimmed = s.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Label/value pairs for the inspector, in display order. Only present
 *  fields are emitted so a screenshot from a non-camera source stays
 *  uncluttered. */
export function formatExifPairs(exif: ExifData): Array<readonly [string, string]> {
	const pairs: Array<readonly [string, string]> = [];
	const camera = [exif.make, exif.model]
		.filter((x): x is string => !!x)
		.join(" ")
		.trim();
	if (camera) pairs.push(["Camera", dedupeMakeModel(exif.make, exif.model, camera)]);
	if (exif.lensModel) pairs.push(["Lens", exif.lensModel]);
	if (exif.dateTimeOriginal) pairs.push(["Taken", formatExifDate(exif.dateTimeOriginal)]);
	if (exif.exposureTime !== undefined) {
		pairs.push(["Exposure", formatExposure(exif.exposureTime)]);
	}
	if (exif.fNumber !== undefined) pairs.push(["Aperture", `ƒ/${trimNum(exif.fNumber)}`]);
	if (exif.iso !== undefined) pairs.push(["ISO", String(exif.iso)]);
	if (exif.focalLength !== undefined) {
		pairs.push(["Focal length", `${trimNum(exif.focalLength)} mm`]);
	}
	const o = describeOrientation(exif.orientation);
	if (o) pairs.push(["Orientation", o]);
	return pairs;
}

/** Many cameras prefix the model with the make ("NIKON" + "NIKON D750");
 *  collapse the redundancy for a clean inspector row. */
function dedupeMakeModel(
	make: string | undefined,
	model: string | undefined,
	joined: string,
): string {
	if (make && model && model.toUpperCase().startsWith(make.toUpperCase())) {
		return model;
	}
	return joined;
}

function formatExposure(seconds: number): string {
	if (seconds <= 0) return `${seconds}`;
	if (seconds >= 1) return `${trimNum(seconds)} s`;
	return `1/${Math.round(1 / seconds)} s`;
}

function trimNum(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** EXIF datetime is `YYYY:MM:DD HH:MM:SS`; show a friendlier form. */
function formatExifDate(raw: string): string {
	const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
	if (!m) return raw;
	const [, y, mo, d, h, mi] = m;
	const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
	if (Number.isNaN(date.getTime())) return raw;
	return `${date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	})}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function describeOrientation(o: number | undefined): string | null {
	switch (o) {
		case 1:
			return null; // Normal — not worth a row.
		case 2:
			return "Mirrored";
		case 3:
			return "Rotated 180°";
		case 4:
			return "Mirrored, 180°";
		case 5:
			return "Mirrored, 90° CCW";
		case 6:
			return "Rotated 90° CW";
		case 7:
			return "Mirrored, 90° CW";
		case 8:
			return "Rotated 90° CCW";
		default:
			return null;
	}
}

// NOTE: the renderer does NOT manually rotate the image. Chromium honours
// CSS `image-orientation: from-image` (the spec initial value) by default,
// so an `<img>` already displays EXIF-rotated and `naturalWidth/Height`
// report the orientation-corrected size. Compositing a manual `rotate()`
// onto the pan/zoom transform would double-correct AND rotate the pan
// axes. The orientation tag is parsed purely so the inspector can *report*
// it (`describeOrientation` above).
