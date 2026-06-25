/**
 * EPUB → `BookContent` extraction (9.21.2, OQ-BK-1 hybrid). epub.js is used
 * ONLY as the parser (open the archive, resolve the spine + per-section XHTML +
 * metadata — see `epub-parser.ts`); this module turns each section's XHTML into
 * the renderer-agnostic `BookContent` the existing reflow reader / pagination /
 * typography / highlights already consume. epub.js's own iframe `Rendition` is
 * never used (it conflicts with the per-app sandbox CSP).
 *
 * Pure (DOM-only via `DOMParser`) so it is fully jsdom-unit-testable without the
 * epub.js dependency or a real EPUB.
 */

import { BlockKind, type BookContent, type ContentBlock, type SpineItem } from "./content";

/** A raw spine section handed in by the epub.js glue: the chapter title (or "")
 *  and its XHTML body markup. */
export type RawSection = {
	title: string;
	html: string;
};

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const BLOCK_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "DD", "DT", "FIGCAPTION"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD"]);

/** Collapse runs of whitespace (incl. newlines from the source markup) to single
 *  spaces and trim — the reflow renderer owns visual wrapping. */
function normalizeText(raw: string): string {
	return raw.replace(/\s+/g, " ").trim();
}

/**
 * Extract reflowable blocks from a section's XHTML. Headings (`h1`–`h6`) become
 * {@link BlockKind.Heading}; paragraph-like blocks (`p`, `li`, `blockquote`, …)
 * become {@link BlockKind.Paragraph}. The walk descends through generic
 * containers (`div`/`section`/`article`) but never re-emits text already claimed
 * by a nested block, so content isn't duplicated. Empty blocks drop.
 */
export function htmlToBlocks(html: string): ContentBlock[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const blocks: ContentBlock[] = [];

	const visit = (node: Element): void => {
		const tag = node.tagName.toUpperCase();
		if (SKIP_TAGS.has(tag)) return;
		if (HEADING_TAGS.has(tag)) {
			const text = normalizeText(node.textContent ?? "");
			if (text) blocks.push({ kind: BlockKind.Heading, text });
			return;
		}
		if (BLOCK_TAGS.has(tag)) {
			const text = normalizeText(node.textContent ?? "");
			if (text) blocks.push({ kind: BlockKind.Paragraph, text });
			return;
		}
		// Generic container — descend so nested headings/paragraphs are found.
		for (const child of Array.from(node.children)) visit(child);
	};

	const root = doc.body ?? doc.documentElement;
	for (const child of Array.from(root.children)) visit(child);

	// Fallback: a section with bare text and no block elements (rare, malformed)
	// still yields one paragraph rather than an empty chapter.
	if (blocks.length === 0) {
		const text = normalizeText(root.textContent ?? "");
		if (text) blocks.push({ kind: BlockKind.Paragraph, text });
	}
	return blocks;
}

/** Build `BookContent` from EPUB metadata + the parsed spine sections. Sections
 *  with no extractable text are dropped (cover/nav pages), but at least one
 *  empty spine item is kept so the reader never mounts an empty book. */
export function bookContentFrom(
	meta: { title: string; author: string },
	sections: readonly RawSection[],
): BookContent {
	const spine: SpineItem[] = [];
	sections.forEach((section, index) => {
		const blocks = htmlToBlocks(section.html);
		if (blocks.length === 0) return;
		spine.push({ title: section.title || `Chapter ${index + 1}`, blocks });
	});
	if (spine.length === 0) spine.push({ title: meta.title || "Untitled", blocks: [] });
	return {
		title: meta.title || "Untitled",
		author: meta.author || "",
		spine,
	};
}
