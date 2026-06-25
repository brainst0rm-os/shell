/**
 * RAW preview keystone — 9.20.11.
 *
 * Camera RAW files (CR2 / NEF / ARW / DNG / ORF / RW2 …) are TIFF-based
 * containers that embed one or more JPEG preview images alongside the
 * sensor mosaic. Browsers can't decode the mosaic, but they render the
 * embedded JPEG natively — so the fast, dependency-free Quick-Look path
 * is to walk the TIFF IFD tree, find the largest embedded JPEG, and hand
 * those bytes to the existing image renderer. No multi-megabyte WASM RAW
 * decoder on the cold-start path.
 *
 * **Security:** this parses fully untrusted bytes. Every read is
 * bounds-checked, IFD traversal is depth/iteration-bounded with a
 * visited-set (malicious circular IFD pointers can't loop), and the
 * returned slice is validated to start with the JPEG SOI marker and lie
 * within the buffer. A parse failure degrades to a marker scan, then to
 * `null` — never an out-of-range read or an unbounded loop.
 */

/** Camera Make / Model pulled from IFD0, for the inspector. */
export type RawInfo = { make?: string; model?: string };

const SOI = 0xffd8; // JPEG start-of-image
const EOI = 0xffd9; // JPEG end-of-image

const TIFF_LE = 0x4949; // "II"
const TIFF_BE = 0x4d4d; // "MM"

enum Tag {
	Make = 0x010f,
	Model = 0x0110,
	Compression = 0x0103,
	StripOffsets = 0x0111,
	StripByteCounts = 0x0117,
	SubIFDs = 0x014a,
	JpegOffset = 0x0201, // JPEGInterchangeFormat
	JpegLength = 0x0202, // JPEGInterchangeFormatLength
}

const COMPRESSION_OLD_JPEG = 6;
const COMPRESSION_JPEG = 7;

const MAX_IFDS = 96; // generous ceiling across IFD chain + SubIFDs
const MAX_ENTRIES = 512; // per-IFD entry sanity cap

type JpegSpan = { offset: number; length: number };

class Reader {
	private readonly view: DataView;
	readonly length: number;
	constructor(
		bytes: Uint8Array,
		private readonly le: boolean,
	) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.length = bytes.byteLength;
	}
	u16(off: number): number | null {
		if (off < 0 || off + 2 > this.length) return null;
		return this.view.getUint16(off, this.le);
	}
	u32(off: number): number | null {
		if (off < 0 || off + 4 > this.length) return null;
		return this.view.getUint32(off, this.le);
	}
}

/** Big-endian 16-bit read of a marker pair; out-of-range bytes read as 0
 *  (callers bounds-check the index range first). */
function u16be(bytes: Uint8Array, i: number): number {
	return ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
}

function isLittleEndian(bytes: Uint8Array): boolean | null {
	if (bytes.byteLength < 8) return null;
	const order = u16be(bytes, 0);
	if (order === TIFF_LE) return true;
	if (order === TIFF_BE) return false;
	return null;
}

/** Walk the TIFF IFD tree collecting embedded-JPEG spans + camera id.
 *  Returns `null` only when the buffer isn't a TIFF container at all. */
function parseTiff(bytes: Uint8Array): { jpegs: JpegSpan[]; info: RawInfo } | null {
	const le = isLittleEndian(bytes);
	if (le === null) return null;
	const r = new Reader(bytes, le);
	const first = r.u32(4);
	if (first === null) return null;

	const jpegs: JpegSpan[] = [];
	const info: RawInfo = {};
	const visited = new Set<number>();
	const queue: number[] = [first];
	let walked = 0;

	while (queue.length > 0 && walked < MAX_IFDS) {
		const ifd = queue.shift();
		if (ifd === undefined || ifd < 8 || visited.has(ifd)) continue;
		visited.add(ifd);
		walked++;

		const count = r.u16(ifd);
		if (count === null || count === 0 || count > MAX_ENTRIES) continue;
		const entriesEnd = ifd + 2 + count * 12;
		if (entriesEnd + 4 > r.length) continue;

		let jpegOffset: number | null = null;
		let jpegLength: number | null = null;
		let stripOffset: number | null = null;
		let stripLength: number | null = null;
		let compression: number | null = null;

		for (let i = 0; i < count; i++) {
			const e = ifd + 2 + i * 12;
			const tag = r.u16(e);
			const type = r.u16(e + 2);
			const valCount = r.u32(e + 4);
			if (tag === null || type === null || valCount === null) continue;
			const valueField = e + 8;

			switch (tag) {
				case Tag.JpegOffset:
					jpegOffset = r.u32(valueField);
					break;
				case Tag.JpegLength:
					jpegLength = r.u32(valueField);
					break;
				case Tag.StripOffsets:
					stripOffset = scalarLongOrShort(r, valueField, type);
					break;
				case Tag.StripByteCounts:
					stripLength = scalarLongOrShort(r, valueField, type);
					break;
				case Tag.Compression:
					compression = scalarLongOrShort(r, valueField, type);
					break;
				case Tag.SubIFDs:
					for (const sub of readSubIfdOffsets(r, valueField, valCount)) queue.push(sub);
					break;
				case Tag.Make: {
					const v = readAscii(bytes, r, valueField, valCount);
					if (v && info.make === undefined) info.make = v;
					break;
				}
				case Tag.Model: {
					const v = readAscii(bytes, r, valueField, valCount);
					if (v && info.model === undefined) info.model = v;
					break;
				}
			}
		}

		if (jpegOffset !== null && jpegLength !== null) {
			jpegs.push({ offset: jpegOffset, length: jpegLength });
		} else if (
			(compression === COMPRESSION_JPEG || compression === COMPRESSION_OLD_JPEG) &&
			stripOffset !== null &&
			stripLength !== null
		) {
			jpegs.push({ offset: stripOffset, length: stripLength });
		}

		const next = r.u32(entriesEnd);
		if (next !== null && next !== 0) queue.push(next);
	}

	return { jpegs, info };
}

/** A scalar LONG/SHORT held inline in the entry's value field. */
function scalarLongOrShort(r: Reader, valueField: number, type: number): number | null {
	// type 3 = SHORT, 4 = LONG. Anything else (e.g. a multi-strip array) is
	// treated as "not a single inline scalar" and ignored.
	if (type === 3) return r.u16(valueField);
	if (type === 4) return r.u32(valueField);
	return null;
}

/** SubIFD offsets: one inline LONG, or an array referenced by the value
 *  field. Bounded so a huge `count` can't fan out unboundedly. */
function readSubIfdOffsets(r: Reader, valueField: number, count: number): number[] {
	const out: number[] = [];
	const n = Math.min(count, 16);
	if (n <= 1) {
		const off = r.u32(valueField);
		if (off !== null) out.push(off);
		return out;
	}
	const base = r.u32(valueField);
	if (base === null) return out;
	for (let i = 0; i < n; i++) {
		const off = r.u32(base + i * 4);
		if (off !== null) out.push(off);
	}
	return out;
}

function readAscii(
	bytes: Uint8Array,
	r: Reader,
	valueField: number,
	count: number,
): string | undefined {
	if (count === 0) return undefined;
	const start = count <= 4 ? valueField : r.u32(valueField);
	if (start === null || start < 0 || start + count > bytes.byteLength) return undefined;
	let end = start;
	const limit = start + count;
	while (end < limit && bytes[end] !== 0) end++;
	const text = new TextDecoder().decode(bytes.subarray(start, end)).trim();
	return text.length > 0 ? text : undefined;
}

function looksLikeJpeg(bytes: Uint8Array, offset: number): boolean {
	return offset >= 0 && offset + 2 <= bytes.byteLength && u16be(bytes, offset) === SOI;
}

/** Last-resort: the largest plausible `FFD8 … FFD9` region. Embedded JPEG
 *  previews carry the only genuine EOI (in-scan 0xFF bytes are stuffed /
 *  restart markers), so first-SOI → last-EOI reliably brackets the preview
 *  when IFD parsing didn't yield one. */
function scanForJpeg(bytes: Uint8Array): Uint8Array | null {
	const n = bytes.byteLength;
	let start = -1;
	for (let i = 0; i + 1 < n; i++) {
		if (u16be(bytes, i) === SOI) {
			start = i;
			break;
		}
	}
	if (start < 0) return null;
	let end = -1;
	for (let i = n - 2; i > start; i--) {
		if (u16be(bytes, i) === EOI) {
			end = i + 2;
			break;
		}
	}
	if (end <= start) return null;
	return bytes.subarray(start, end);
}

/** Extract the largest embedded JPEG preview from a RAW container, or
 *  `null` when none can be found. The returned slice is a view into the
 *  input (no copy) and is guaranteed to start with the JPEG SOI marker. */
export function extractEmbeddedJpeg(bytes: Uint8Array): Uint8Array | null {
	const parsed = parseTiff(bytes);
	if (parsed) {
		const valid = parsed.jpegs
			.filter((j) => j.length > 0 && j.offset + j.length <= bytes.byteLength)
			.filter((j) => looksLikeJpeg(bytes, j.offset))
			.sort((a, b) => b.length - a.length);
		const best = valid[0];
		if (best) return bytes.subarray(best.offset, best.offset + best.length);
	}
	return scanForJpeg(bytes);
}

/** Camera Make / Model for the inspector — best-effort, parse-light. */
export function readRawInfo(bytes: Uint8Array): RawInfo {
	return parseTiff(bytes)?.info ?? {};
}
