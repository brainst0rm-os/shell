import { describe, expect, it } from "vitest";
import { formatBitrate, parseMp3Frame } from "./mp3-frame";

// ── Builders (hand-built MPEG audio frame headers, exif/id3.test style) ─────
//
// byte0 = 0xFF; byte1 = 111 VV LL P; byte2 = BBBB SS pp x.
//  - MPEG1 LayerIII 320 kbps @ 44.1 kHz → FF FB E0 00
//  - MPEG2 LayerIII 160 kbps @ 22.05kHz → FF F3 E0 00
const V1_L3_320 = [0xff, 0xfb, 0xe0, 0x00];
const V2_L3_160 = [0xff, 0xf3, 0xe0, 0x00];

function buf(...parts: number[][]): Uint8Array {
	return new Uint8Array(parts.flat());
}

function syncsafe(n: number): number[] {
	return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

describe("parseMp3Frame", () => {
	it("decodes a MPEG1 Layer III header (320 kbps / 44.1 kHz)", () => {
		expect(parseMp3Frame(buf(V1_L3_320))).toEqual({ bitrateKbps: 320, sampleRateHz: 44100 });
	});

	it("decodes a MPEG2 Layer III header (160 kbps / 22.05 kHz)", () => {
		expect(parseMp3Frame(buf(V2_L3_160))).toEqual({ bitrateKbps: 160, sampleRateHz: 22050 });
	});

	it("skips a leading ID3v2 tag and finds the first audio frame", () => {
		const id3 = [0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(5), 0, 0, 0, 0, 0];
		expect(parseMp3Frame(buf(id3, V1_L3_320))).toEqual({
			bitrateKbps: 320,
			sampleRateHz: 44100,
		});
	});

	it("finds the sync past a junk prefix (no ID3 tag)", () => {
		expect(parseMp3Frame(buf([0x00, 0x13, 0x37], V1_L3_320))).toEqual({
			bitrateKbps: 320,
			sampleRateHz: 44100,
		});
	});

	it("rejects reserved version / reserved layer", () => {
		expect(parseMp3Frame(buf([0xff, 0xeb, 0xe0, 0x00]))).toBeNull(); // VV=01 reserved
		expect(parseMp3Frame(buf([0xff, 0xf9, 0xe0, 0x00]))).toBeNull(); // LL=00 reserved
	});

	it("rejects free (idx 0) / bad (idx 15) bitrate and reserved sample rate", () => {
		expect(parseMp3Frame(buf([0xff, 0xfb, 0x00, 0x00]))).toBeNull(); // bitrate idx 0
		expect(parseMp3Frame(buf([0xff, 0xfb, 0xf0, 0x00]))).toBeNull(); // bitrate idx 15
		expect(parseMp3Frame(buf([0xff, 0xfb, 0xec, 0x00]))).toBeNull(); // sample idx 3
	});

	it("non-MPEG / empty / truncated input → null (no throw)", () => {
		expect(parseMp3Frame(null)).toBeNull();
		expect(parseMp3Frame(new Uint8Array(0))).toBeNull();
		expect(parseMp3Frame(buf([0x52, 0x49, 0x46, 0x46]))).toBeNull(); // "RIFF" (WAV)
		expect(parseMp3Frame(buf([0xff]))).toBeNull(); // truncated header
	});

	it("does not scan unboundedly — a sync only after a huge non-MPEG prefix is not found", () => {
		const junk = new Array(8000).fill(0x00);
		expect(parseMp3Frame(buf(junk, V1_L3_320))).toBeNull();
	});
});

describe("formatBitrate", () => {
	it("formats kbps + kHz, one decimal", () => {
		expect(formatBitrate({ bitrateKbps: 320, sampleRateHz: 44100 })).toBe("320 kbps · 44.1 kHz");
		expect(formatBitrate({ bitrateKbps: 160, sampleRateHz: 22050 })).toBe("160 kbps · 22.1 kHz");
	});
	it("null info → null (caller omits the row)", () => {
		expect(formatBitrate(null)).toBeNull();
	});
});
