import { describe, expect, it } from "vitest";
import { formatId3Pairs, parseId3 } from "./id3";

// ── Builders (mirrors exif.test's hand-built fixture approach) ──────────────

function syncsafe(n: number): number[] {
	return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}
function plain32(n: number): number[] {
	return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function latin1(s: string): number[] {
	return [...s].map((c) => c.charCodeAt(0) & 0xff);
}

/** A v2.3 text frame: 4-char id + plain32 size + 2 flag bytes + enc + body. */
function v23Frame(id: string, enc: number, body: number[]): number[] {
	const payload = [enc, ...body];
	return [...latin1(id), ...plain32(payload.length), 0, 0, ...payload];
}

/** A v2.2 text frame: 3-char id + 3-byte size + enc + body. */
function v22Frame(id: string, enc: number, body: number[]): number[] {
	const payload = [enc, ...body];
	const size = payload.length;
	return [...latin1(id), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff, ...payload];
}

function v24Frame(id: string, enc: number, body: number[]): number[] {
	const payload = [enc, ...body];
	return [...latin1(id), ...syncsafe(payload.length), 0, 0, ...payload];
}

function id3Tag(major: number, frames: number[][]): Uint8Array {
	const body = frames.flat();
	return new Uint8Array([0x49, 0x44, 0x33, major, 0, 0, ...syncsafe(body.length), ...body]);
}

function id3v1(fields: {
	title?: string;
	artist?: string;
	album?: string;
	year?: string;
}): Uint8Array {
	const pad = (s: string, len: number): number[] => {
		const b = latin1(s).slice(0, len);
		return [...b, ...new Array(len - b.length).fill(0)];
	};
	return new Uint8Array([
		0x54,
		0x41,
		0x47, // "TAG"
		...pad(fields.title ?? "", 30),
		...pad(fields.artist ?? "", 30),
		...pad(fields.album ?? "", 30),
		...pad(fields.year ?? "", 4),
		...new Array(30).fill(0), // comment
		0, // genre byte
	]);
}

describe("parseId3 — ID3v2", () => {
	it("reads v2.3 latin1 text frames", () => {
		const buf = id3Tag(3, [
			v23Frame("TIT2", 0, latin1("Song")),
			v23Frame("TPE1", 0, latin1("Artist")),
			v23Frame("TALB", 0, latin1("Album")),
			v23Frame("TYER", 0, latin1("2026")),
			v23Frame("TCON", 0, latin1("Ambient")),
		]);
		expect(parseId3(buf)).toEqual({
			title: "Song",
			artist: "Artist",
			album: "Album",
			year: "2026",
			genre: "Ambient",
		});
	});

	it("decodes UTF-8 (enc 3) and UTF-16-LE-with-BOM (enc 1)", () => {
		const utf8 = [...new TextEncoder().encode("Café")];
		const u16 = [0xff, 0xfe];
		for (const ch of "Naïve") {
			const c = ch.charCodeAt(0);
			u16.push(c & 0xff, (c >> 8) & 0xff);
		}
		const buf = id3Tag(3, [v23Frame("TIT2", 3, utf8), v23Frame("TPE1", 1, u16)]);
		expect(parseId3(buf)).toEqual({ title: "Café", artist: "Naïve" });
	});

	it("reads v2.2 (3-char ids) and v2.4 (syncsafe frame sizes)", () => {
		expect(parseId3(id3Tag(2, [v22Frame("TT2", 0, latin1("V22"))])).title).toBe("V22");
		expect(
			parseId3(id3Tag(4, [v24Frame("TDRC", 3, [...new TextEncoder().encode("2025")])])).year,
		).toBe("2025");
	});

	it("strips trailing NULs and ignores frames it doesn't map", () => {
		const buf = id3Tag(3, [
			v23Frame("TIT2", 0, [...latin1("Title"), 0, 0]),
			v23Frame("TXXX", 0, latin1("ignored")),
		]);
		expect(parseId3(buf)).toEqual({ title: "Title" });
	});

	it("stops at a padding run without inventing frames", () => {
		const buf = new Uint8Array([...id3Tag(3, [v23Frame("TIT2", 0, latin1("Only"))])]);
		// Append slack zero bytes inside the declared tag size would be
		// padding; the real tag here has none — still parses cleanly.
		expect(parseId3(buf)).toEqual({ title: "Only" });
	});
});

describe("parseId3 — ID3v1 fallback + robustness", () => {
	it("falls back to the 128-byte v1 trailer when no v2 tag is present", () => {
		const audio = new Uint8Array(2048); // arbitrary 'audio' bytes
		const buf = new Uint8Array([...audio, ...id3v1({ title: "V1", artist: "A1", year: "1999" })]);
		expect(parseId3(buf)).toEqual({ title: "V1", artist: "A1", year: "1999" });
	});

	it("v2 wins over a v1 trailer when both exist", () => {
		const buf = new Uint8Array([
			...id3Tag(3, [v23Frame("TIT2", 0, latin1("FromV2"))]),
			...new Uint8Array(512),
			...id3v1({ title: "FromV1" }),
		]);
		expect(parseId3(buf).title).toBe("FromV2");
	});

	it("empty / non-tag / truncated input degrades to {} without throwing", () => {
		expect(parseId3(null)).toEqual({});
		expect(parseId3(new Uint8Array(0))).toEqual({});
		expect(parseId3(new Uint8Array([1, 2, 3, 4, 5]))).toEqual({});
		// "ID3" header claiming a huge frame that runs off the buffer.
		const trunc = new Uint8Array([
			0x49,
			0x44,
			0x33,
			3,
			0,
			0,
			...syncsafe(900),
			...latin1("TIT2"),
			...plain32(900),
			0,
			0,
			0x00,
		]);
		expect(parseId3(trunc)).toEqual({});
	});
});

describe("formatId3Pairs", () => {
	it("emits present fields only, in display order", () => {
		expect(formatId3Pairs({ year: "2026", title: "T", album: "Al" })).toEqual([
			["Title", "T"],
			["Album", "Al"],
			["Year", "2026"],
		]);
		expect(formatId3Pairs({})).toEqual([]);
	});
});
