/**
 * EPUB parser (9.21.2, OQ-BK-1 hybrid) — the thin epub.js glue. Opens the EPUB
 * archive from its bytes, walks the spine, loads each section's XHTML, and hands
 * the markup to the pure `bookContentFrom` extractor → `BookContent`. epub.js is
 * used ONLY as the archive/spine parser; its iframe `Rendition` (which conflicts
 * with the per-app sandbox CSP) is never instantiated.
 *
 * Not unit-tested (needs epub.js + a real EPUB + a DOM) — the extraction logic
 * it delegates to lives in the jsdom-tested `epub-content.ts`. Verified in the
 * real shell (a real EPUB renders in the reflow reader).
 *
 * epub.js (a heavy CJS lib + JSZip) is **dynamically imported** so it stays out
 * of the app's initial bundle/module graph — it loads only when a user actually
 * opens an EPUB (the PDF + library paths never pull it).
 */

import type { BookContent } from "./content";
import { type RawSection, bookContentFrom } from "./epub-content";

/** Parse `bytes` (an EPUB file) into the reflow reader's `BookContent`. */
export async function parseEpub(bytes: Uint8Array): Promise<BookContent> {
	const { default: ePub } = await import("epubjs");
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	const book = ePub(buffer);
	try {
		await book.ready;
		const metadata = book.packaging?.metadata;
		const meta = { title: metadata?.title ?? "", author: metadata?.creator ?? "" };
		const sections: RawSection[] = [];
		for (let i = 0; ; i += 1) {
			const section = book.spine.get(i);
			if (!section) break;
			try {
				// epub.js `section.load()` resolves to the section's `<html>`
				// ELEMENT (`section.contents = documentElement`), not a Document —
				// so `.body` is undefined. Read the body via `querySelector`
				// (works on both an Element and a Document), falling back to the
				// element's own markup (htmlToBlocks skips <head> anyway).
				const doc = (await section.load(book.load.bind(book))) as
					| { querySelector?: (s: string) => Element | null; innerHTML?: string }
					| null
					| undefined;
				const body = doc?.querySelector?.("body");
				const html = body?.innerHTML ?? doc?.innerHTML ?? "";
				sections.push({ title: "", html });
			} catch (error) {
				console.warn(`[books] epub section ${i} load failed:`, error);
			} finally {
				section.unload();
			}
		}
		return bookContentFrom(meta, sections);
	} finally {
		book.destroy();
	}
}
