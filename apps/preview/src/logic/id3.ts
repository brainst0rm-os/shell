/**
 * Minimal ID3 reader — 9.20.7 (audio inspector enrichment).
 *
 * Surfaces the handful of tags Quick Look shows for a sound file (title /
 * artist / album / genre / year). Mirrors `exif.ts`'s discipline: pure,
 * fully bounds-checked (every offset validated against the buffer, the
 * frame walk entry-capped), and any malformed structure degrades to an
 * empty result rather than throwing — a corrupt MP3 must never wedge the
 * previewer.
 *
 * Scope: ID3v2.2 / v2.3 / v2.4 text frames at the *start* of the file,
 * with an ID3v1 128-byte trailer fallback when no v2 tag is present
 * (the dominant real-world cases). APIC cover art, chapters, and the
 * numeric-genre `(13)` ID3v1 cross-reference are out of v1 scope — the
 * card glyph stands in for missing art.
 */

export type Id3Tags = {
	title?: string;
	artist?: string;
	album?: string;
	genre?: string;
	year?: string;
};

/** v2.3/2.4 (4-char) and v2.2 (3-char) frame ids → our field. */
const FRAME_FIELD: Record<string, keyof Id3Tags> = {
	TIT2: "title",
	TPE1: "artist",
	TALB: "album",
	TCON: "genre",
	TYER: "year",
	TDRC: "year",
	TT2: "title",
	TP1: "artist",
	TAL: "album",
	TCO: "genre",
	TYE: "year",
};

const MAX_FRAMES = 256;

function at(a: Uint8Array, i: number): number {
	const v = a[i];
	if (v === undefined) throw new RangeError(`index ${i} out of range`);
	return v;
}

function decodeText(enc: number, bytes: Uint8Array): string {
	if (bytes.length === 0) return "";
	let label = "latin1";
	let body = bytes;
	if (enc === 1) {
		// UTF-16 with BOM.
		if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
			label = "utf-16le";
			body = bytes.subarray(2);
		} else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
			label = "utf-16be";
			body = bytes.subarray(2);
		} else {
			label = "utf-16le";
		}
	} else if (enc === 2) {
		label = "utf-16be";
	} else if (enc === 3) {
		label = "utf-8";
	}
	try {
		return new TextDecoder(label).decode(body).replace(/\0+$/, "").trim();
	} catch {
		return "";
	}
}

/** Syncsafe (7-bits-per-byte) 32-bit integer — the ID3v2 tag-size and
 *  v2.4 frame-size encoding. */
function syncsafe(b: Uint8Array, o: number): number {
	return (at(b, o) << 21) | (at(b, o + 1) << 14) | (at(b, o + 2) << 7) | at(b, o + 3);
}

function plain32(b: Uint8Array, o: number): number {
	return (at(b, o) << 24) | (at(b, o + 1) << 16) | (at(b, o + 2) << 8) | at(b, o + 3);
}

function frameText(bytes: Uint8Array, start: number, size: number): string {
	if (size <= 1 || start + size > bytes.length) return "";
	const enc = at(bytes, start);
	return decodeText(enc, bytes.subarray(start + 1, start + size));
}

function parseV2(bytes: Uint8Array): Id3Tags {
	// 10-byte header: "ID3" v.v flags size(syncsafe).
	if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return {};
	const major = at(bytes, 3);
	if (major !== 2 && major !== 3 && major !== 4) return {};
	const tagSize = syncsafe(bytes, 6);
	if (tagSize <= 0) return {};
	const end = Math.min(10 + tagSize, bytes.length);
	const tags: Id3Tags = {};
	let off = 10;
	const idLen = major === 2 ? 3 : 4;
	const headerLen = major === 2 ? 6 : 10;
	for (let n = 0; n < MAX_FRAMES && off + headerLen <= end; n++) {
		// A padding run (zero bytes where a frame id should be) ends the tag.
		if (bytes[off] === 0) break;
		let id = "";
		for (let i = 0; i < idLen; i++) id += String.fromCharCode(at(bytes, off + i));
		let size: number;
		if (major === 2) {
			size = (at(bytes, off + 3) << 16) | (at(bytes, off + 4) << 8) | at(bytes, off + 5);
		} else if (major === 4) {
			size = syncsafe(bytes, off + 4);
		} else {
			size = plain32(bytes, off + 4);
		}
		const dataStart = off + headerLen;
		if (size <= 0 || dataStart + size > end) break;
		const field = FRAME_FIELD[id];
		if (field && !tags[field]) {
			const value = frameText(bytes, dataStart, size);
			if (value) tags[field] = value;
		}
		off = dataStart + size;
	}
	return tags;
}

function trimNul(s: string): string {
	return s.replace(/[\0\s]+$/, "").trim();
}

function parseV1(bytes: Uint8Array): Id3Tags {
	if (bytes.length < 128) return {};
	const tail = bytes.subarray(bytes.length - 128);
	if (tail[0] !== 0x54 || tail[1] !== 0x41 || tail[2] !== 0x47) return {}; // "TAG"
	const latin1 = (a: number, b: number): string => {
		try {
			return trimNul(new TextDecoder("latin1").decode(tail.subarray(a, b)));
		} catch {
			return "";
		}
	};
	const tags: Id3Tags = {};
	const title = latin1(3, 33);
	const artist = latin1(33, 63);
	const album = latin1(63, 93);
	const year = latin1(93, 97);
	if (title) tags.title = title;
	if (artist) tags.artist = artist;
	if (album) tags.album = album;
	if (year) tags.year = year;
	return tags;
}

/**
 * Best-effort ID3 read. ID3v2 (front of file) wins; if absent, the
 * ID3v1 128-byte trailer is the fallback. Never throws — any structural
 * problem yields `{}` and the inspector simply shows fewer rows.
 */
export function parseId3(bytes: Uint8Array | null | undefined): Id3Tags {
	if (!bytes || bytes.length === 0) return {};
	try {
		const v2 = parseV2(bytes);
		if (Object.keys(v2).length > 0) return v2;
		return parseV1(bytes);
	} catch {
		return {};
	}
}

/** Present fields only, in display order — the shape the inspector folds
 *  into its pair list (mirrors `formatExifPairs`). */
export function formatId3Pairs(tags: Id3Tags): Array<readonly [string, string]> {
	const pairs: Array<readonly [string, string]> = [];
	if (tags.title) pairs.push(["Title", tags.title]);
	if (tags.artist) pairs.push(["Artist", tags.artist]);
	if (tags.album) pairs.push(["Album", tags.album]);
	if (tags.genre) pairs.push(["Genre", tags.genre]);
	if (tags.year) pairs.push(["Year", tags.year]);
	return pairs;
}
