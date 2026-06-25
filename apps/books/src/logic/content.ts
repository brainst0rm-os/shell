/**
 * The in-memory content model the preview renderer reflows. A `Book/v1`'s
 * binary is parsed (epub.js in 9.21.2) into this shape; the preview ships
 * a hand-authored sample (see sample-book.ts) so the whole reader works
 * before the parser dep lands. This model is intentionally renderer-
 * agnostic — pure data + character offsets that the locator math indexes.
 */

export enum BlockKind {
	Heading = "heading",
	Paragraph = "paragraph",
}

/** One reflowable block within a spine item. `text` is the plain text; the
 *  block's character offsets are *local to its spine item* and assigned by
 *  `indexSpine` so a `Locator.charOffset` resolves to (block, intra-block
 *  offset). */
export type ContentBlock = {
	kind: BlockKind;
	text: string;
};

/** One spine item (an EPUB chapter / a PDF page). */
export type SpineItem = {
	title: string;
	blocks: ContentBlock[];
};

export type BookContent = {
	title: string;
	author: string;
	spine: SpineItem[];
};

/** The character span a block occupies within its spine item's flat text. */
export type IndexedBlock = {
	block: ContentBlock;
	/** Inclusive start offset within the spine item. */
	start: number;
	/** Exclusive end offset within the spine item. */
	end: number;
};

export type IndexedSpineItem = {
	item: SpineItem;
	blocks: IndexedBlock[];
	/** Total character length of the spine item (sum of block text lengths). */
	length: number;
};

/** Assign character offsets to every block in a spine item. Blocks are
 *  concatenated head-to-tail (no separator chars) so offsets stay stable
 *  regardless of how the renderer joins them visually. */
export function indexSpineItem(item: SpineItem): IndexedSpineItem {
	let cursor = 0;
	const blocks: IndexedBlock[] = item.blocks.map((block) => {
		const start = cursor;
		const end = start + block.text.length;
		cursor = end;
		return { block, start, end };
	});
	return { item, blocks, length: cursor };
}

export function indexSpine(content: BookContent): IndexedSpineItem[] {
	return content.spine.map(indexSpineItem);
}

/** Total characters across the whole book — the denominator for reading
 *  progress. */
export function totalLength(indexed: IndexedSpineItem[]): number {
	return indexed.reduce((sum, s) => sum + s.length, 0);
}
