/**
 * Audio renderer — 9.20.3.
 *
 * A centred media card (filename + format chip + a waveform-evoking
 * glyph) above the native `<audio controls>` transport — audio has no
 * visual surface, so the card is the "art" Quick Look shows for a sound
 * file. The inspector shows duration + format (probe element), ID3
 * title / artist / album / genre / year (`logic/id3.ts`, 9.20.7a) and
 * bitrate + sample-rate (`logic/mp3-frame.ts`, 9.20.7); cover art stays
 * a noted follow-up — the card glyph stands in. -
 * `dispose()` pauses, detaches + aborts the load, and revokes any owned
 * object URL.
 */

import { formatId3Pairs, parseId3 } from "../logic/id3";
import { shortFormat } from "../logic/media-info";
import { formatBitrate, parseMp3Frame } from "../logic/mp3-frame";
import { PreviewKind } from "../types/preview-kind";
import type {
	PreviewInstance,
	PreviewModule,
	PreviewMountContext,
	PreviewSource,
} from "../types/preview-module";
import { applySourceToMedia } from "./media-source";
import { probeMediaMetadata } from "./video-renderer";

export const audioRenderer: PreviewModule = {
	kind: PreviewKind.Audio,
	mount(context: PreviewMountContext): PreviewInstance {
		return mountAudio(context);
	},
	async extractMetadata(source) {
		// Duration + format come from a metadata-only probe element;
		// title / artist / album / genre / year from the ID3 tag; bitrate
		// + sample-rate from the first MPEG audio frame. Each is
		// best-effort and independent — one failing source never blanks
		// the others. The source bytes are fetched once and shared by the
		// ID3 + MP3-frame reads.
		const out = await probeMediaMetadata(source, false);
		try {
			const bytes = await audioSourceBytes(source);
			for (const [label, value] of formatId3Pairs(parseId3(bytes))) {
				out[label] = value;
			}
			const rate = formatBitrate(parseMp3Frame(bytes));
			if (rate) out.Bitrate = rate;
		} catch {
			// ID3 / bitrate are decorative — never let them blank the
			// inspector.
		}
		return out;
	},
};

/** Bytes for the ID3 read. Mirrors the image renderer's `sourceBytes`:
 *  direct for a bytes source, a best-effort fetch for a URL one (blob: /
 *  data: / brainstorm:// are re-readable in the sandbox). */
async function audioSourceBytes(source: PreviewSource): Promise<Uint8Array | null> {
	if (source.kind === "bytes") return source.bytes;
	try {
		const res = await fetch(source.url);
		return new Uint8Array(await res.arrayBuffer());
	} catch {
		return null;
	}
}

function mountAudio(context: PreviewMountContext): PreviewInstance {
	const { host, source, file } = context;
	host.replaceChildren();

	const stage = document.createElement("div");
	stage.className = "preview-stage preview-stage--media preview-stage--audio";

	const card = document.createElement("div");
	card.className = "preview-audio__card";

	const art = document.createElement("div");
	art.className = "preview-audio__art";
	art.setAttribute("aria-hidden", "true");
	art.appendChild(waveformGlyph());

	const name = document.createElement("div");
	name.className = "preview-audio__name";
	name.textContent = file.name;
	name.title = file.name;

	const fmt = document.createElement("div");
	fmt.className = "preview-audio__format";
	fmt.textContent = shortFormat(source.mime);

	const audio = document.createElement("audio");
	audio.className = "preview-audio__player";
	audio.controls = true;
	audio.preload = "metadata";
	audio.setAttribute("aria-label", file.name);
	const ownedUrl = applySourceToMedia(audio, source);

	card.append(art, name, fmt, audio);
	stage.appendChild(card);
	host.appendChild(stage);

	return {
		dispose(): void {
			try {
				audio.pause();
				audio.removeAttribute("src");
				audio.load();
			} catch {
				// teardown must not throw
			}
			if (ownedUrl) URL.revokeObjectURL(ownedUrl);
			host.replaceChildren();
		},
	};
}

function waveformGlyph(): SVGSVGElement {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 48 48");
	svg.setAttribute("width", "48");
	svg.setAttribute("height", "48");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "3");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("focusable", "false");
	const bars: ReadonlyArray<[number, number]> = [
		[10, 16],
		[18, 8],
		[26, 22],
		[34, 13],
		[42, 18],
	];
	for (const [x, half] of bars) {
		const line = document.createElementNS(ns, "line");
		line.setAttribute("x1", String(x));
		line.setAttribute("x2", String(x));
		line.setAttribute("y1", String(24 - half));
		line.setAttribute("y2", String(24 + half));
		svg.appendChild(line);
	}
	return svg;
}
