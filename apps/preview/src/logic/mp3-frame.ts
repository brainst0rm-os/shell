/**
 * Minimal MPEG-audio frame-header reader — 9.20.7 (audio bitrate, the
 * last inspector field after 9.20.7a's ID3 tags).
 *
 * The `<audio>` element exposes no bitrate, and ID3 frames don't carry
 * it reliably, so we read it from the first real MPEG audio frame:
 * skip a leading ID3v2 tag, scan a bounded window for the 11-bit frame
 * sync, decode the 32-bit header, and look the bitrate up in the spec
 * tables (CBR — the dominant `.mp3` case; a VBR file reports its first
 * frame's rate, the same number every desktop file manager shows).
 *
 * Same discipline as `exif.ts` / `id3.ts`: pure, fully bounds-checked,
 * any malformed / non-MPEG input → `null` (no Bitrate row, never a
 * throw). Non-MPEG containers (WAV/OGG/FLAC/M4A) carry no MPEG sync and
 * correctly yield `null`.
 */

export type Mp3FrameInfo = {
	/** Nominal bitrate in kbps (e.g. 320). */
	bitrateKbps: number;
	/** Sample rate in Hz (e.g. 44100). */
	sampleRateHz: number;
};

// MPEG version (bits 20..19) and Layer (18..17) decode tables.
enum MpegVersion {
	V25 = 0, // MPEG 2.5
	Reserved = 1,
	V2 = 2, // MPEG 2
	V1 = 3, // MPEG 1
}
enum MpegLayer {
	Reserved = 0,
	L3 = 1,
	L2 = 2,
	L1 = 3,
}

// Bitrate (kbps) by index 0..15. Index 0 = "free", 15 = "bad" → both
// rejected (returned as null by the caller). Three column groups:
// MPEG1-LayerI, MPEG1-LayerII, MPEG1-LayerIII, MPEG2/2.5-LayerI,
// MPEG2/2.5-LayerII&III.
const BR_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1];
const BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1];
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
const BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, -1];
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];

const SR_V1 = [44100, 48000, 32000, -1];
const SR_V2 = [22050, 24000, 16000, -1];
const SR_V25 = [11025, 12000, 8000, -1];

function at(a: Uint8Array, i: number): number {
	const v = a[i];
	if (v === undefined) throw new RangeError(`index ${i} out of range`);
	return v;
}

/** Syncsafe 32-bit (7 bits/byte) — the ID3v2 tag-size encoding, so we
 *  can skip a leading tag and find the real audio. */
function syncsafe(b: Uint8Array, o: number): number {
	return (at(b, o) << 21) | (at(b, o + 1) << 14) | (at(b, o + 2) << 7) | at(b, o + 3);
}

function decodeHeader(b: Uint8Array, o: number): Mp3FrameInfo | null {
	// 4-byte header; sync = 11 bits set (FF Ex).
	if (b[o] !== 0xff || (at(b, o + 1) & 0xe0) !== 0xe0) return null;
	const version = (at(b, o + 1) >> 3) & 0x03;
	const layer = (at(b, o + 1) >> 1) & 0x03;
	if (version === MpegVersion.Reserved || layer === MpegLayer.Reserved) return null;
	const bitrateIdx = (at(b, o + 2) >> 4) & 0x0f;
	const sampleIdx = (at(b, o + 2) >> 2) & 0x03;
	if (bitrateIdx === 0 || bitrateIdx === 15 || sampleIdx === 3) return null;

	const isV1 = version === MpegVersion.V1;
	let brTable: number[];
	if (isV1) {
		brTable = layer === MpegLayer.L1 ? BR_V1_L1 : layer === MpegLayer.L2 ? BR_V1_L2 : BR_V1_L3;
	} else {
		brTable = layer === MpegLayer.L1 ? BR_V2_L1 : BR_V2_L23;
	}
	const bitrateKbps = brTable[bitrateIdx] ?? -1;
	if (bitrateKbps <= 0) return null;

	const srTable = isV1 ? SR_V1 : version === MpegVersion.V2 ? SR_V2 : SR_V25;
	const sampleRateHz = srTable[sampleIdx] ?? -1;
	if (sampleRateHz <= 0) return null;

	return { bitrateKbps, sampleRateHz };
}

/** How far past a (possible) ID3v2 tag we'll scan for the frame sync. A
 *  real MP3's first frame is within the first few KB; the cap keeps a
 *  pathological / non-MPEG buffer from being walked end-to-end. */
const SCAN_WINDOW = 4096;

export function parseMp3Frame(bytes: Uint8Array | null | undefined): Mp3FrameInfo | null {
	if (!bytes || bytes.length < 4) return null;
	try {
		let start = 0;
		// Skip a leading ID3v2 tag ("ID3" + 10-byte header + syncsafe size).
		if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
			const size = syncsafe(bytes, 6);
			if (size > 0) start = Math.min(10 + size, bytes.length);
		}
		const end = Math.min(start + SCAN_WINDOW, bytes.length - 4);
		for (let i = start; i <= end; i++) {
			if (bytes[i] === 0xff && (at(bytes, i + 1) & 0xe0) === 0xe0) {
				const info = decodeHeader(bytes, i);
				if (info) return info;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/** Inspector value, e.g. `320 kbps · 44.1 kHz`. `null` info → null (the
 *  caller omits the row). */
export function formatBitrate(info: Mp3FrameInfo | null): string | null {
	if (!info) return null;
	const khz = Math.round((info.sampleRateHz / 1000) * 10) / 10;
	return `${info.bitrateKbps} kbps · ${khz} kHz`;
}
