/**
 * An in-memory sample book for the 9.21.1.5 preview drop — the demo
 * dataset that lets the whole reader work end-to-end before the epub.js
 * parser (9.21.2) can produce real `BookContent`. Replaced (not extended)
 * by the parser; the model it conforms to is permanent.
 *
 * Strings here are demo *book content*, not app chrome — they are the
 * payload the reader displays, so they don't flow through `t()` (the same
 * way Notes' seeded body text isn't localized).
 */

import { type Book, BookFormat, emptyReadingState } from "../types/book";
import { IconKind } from "../types/icon";
import { BlockKind, type BookContent } from "./content";

export const SAMPLE_BOOK_CONTENT: BookContent = {
	title: "On the Shape of Vaults",
	author: "A. Reader",
	spine: [
		{
			title: "Chapter I — The Reflow",
			blocks: [
				{ kind: BlockKind.Heading, text: "The Reflow" },
				{
					kind: BlockKind.Paragraph,
					text:
						"A book is not a stack of pages. It is a single stream of words, and the pages are only where that stream happens to break against the edge of the glass. Change the glass — make the type larger, the column narrower — and the breaks move, yet not one word is lost.",
				},
				{
					kind: BlockKind.Paragraph,
					text:
						"This is why a position must be anchored to the words, not to the page. A page number means nothing once the type grows; a character offset means everything, because the words do not move even when their pages do.",
				},
				{
					kind: BlockKind.Paragraph,
					text:
						"The reader you are holding remembers where you stopped by the words around you. Close it, change the type, open it again: you return to the same sentence, on whatever page it now lives.",
				},
			],
		},
		{
			title: "Chapter II — The Anchor",
			blocks: [
				{ kind: BlockKind.Heading, text: "The Anchor" },
				{
					kind: BlockKind.Paragraph,
					text:
						"A highlight is a small promise: this passage mattered. The promise is kept only if the highlight stays over the same words forever, through every reflow and every revision of the type.",
				},
				{
					kind: BlockKind.Paragraph,
					text:
						"So a highlight is anchored, like a position, to a span of characters in the stream. It carries the words it covered, so that even if the book is replaced by a longer edition, the highlight can find its way home by the text it remembers.",
				},
				{
					kind: BlockKind.Paragraph,
					text:
						"Held this way, a highlight is no longer a mark scrawled in a margin. It is a thing in its own right — something you can list, link to, and gather into a note, long after you have closed the book that held it.",
				},
				{
					kind: BlockKind.Paragraph,
					text:
						"And that is the whole of it. A stream of words, a way to point into it that the pages cannot disturb, and the patience to recompute the breaks whenever the glass changes shape.",
				},
			],
		},
	],
};

/** The catalog `Book/v1` record for the sample. `fileId` is null — the
 *  preview sample is in-memory and has no backing Files-host binary. */
export function sampleBook(now: number): Book {
	const spineLength = SAMPLE_BOOK_CONTENT.spine.length;
	return {
		id: "sample-book",
		name: SAMPLE_BOOK_CONTENT.title,
		icon: { kind: IconKind.Emoji, value: "📖" },
		format: BookFormat.Epub,
		author: SAMPLE_BOOK_CONTENT.author,
		fileId: null,
		spineLength,
		reading: emptyReadingState(),
		createdAt: now,
		updatedAt: now,
	};
}
