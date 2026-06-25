/**
 * PPTX text extraction — 9.20.9.
 *
 * There's no faithful client-side PowerPoint *renderer*, so the honest
 * Quick-Look is a per-slide text outline. A `.pptx` is an OOXML zip; the
 * renderer unzips it (fflate) and hands the entry map here. This module is
 * pure — it takes `filename → bytes` and returns ordered slide outlines —
 * so it's fully unit-testable without a zip library.
 */

export type PptxSlide = { index: number; lines: string[] };

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PARAGRAPH_RE = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
const TEXT_RUN_RE = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;

function decodeXmlEntities(s: string): string {
	return (
		s
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
			.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
			// Ampersand last so a literal "&amp;lt;" isn't double-decoded.
			.replace(/&amp;/g, "&")
	);
}

/** Pull the visible text of one slide's XML, one line per `<a:p>`. */
export function slideLines(xml: string): string[] {
	const lines: string[] = [];
	for (const para of xml.matchAll(PARAGRAPH_RE)) {
		const body = para[1] ?? "";
		let text = "";
		for (const run of body.matchAll(TEXT_RUN_RE)) {
			text += decodeXmlEntities(run[1] ?? "");
		}
		const trimmed = text.trim();
		if (trimmed.length > 0) lines.push(trimmed);
	}
	return lines;
}

/** Ordered slide outlines from an unzipped PPTX entry map. Slides are
 *  sorted by their numeric filename suffix; empty slides are kept (so the
 *  slide count is faithful) with an empty `lines` array. */
export function slidesFromEntries(entries: Record<string, Uint8Array>): PptxSlide[] {
	const decoder = new TextDecoder();
	const slides: PptxSlide[] = [];
	for (const [name, bytes] of Object.entries(entries)) {
		const match = SLIDE_RE.exec(name);
		if (!match) continue;
		slides.push({ index: Number(match[1]), lines: slideLines(decoder.decode(bytes)) });
	}
	slides.sort((a, b) => a.index - b.index);
	return slides;
}
