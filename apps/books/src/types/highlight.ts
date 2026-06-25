/**
 * `Highlight/v1` — a first-class anchored annotation over a span of a
 * book, NOT an inline mark stored in the book body. It carries a stable
 * `LocatorRange` anchor (so it survives re-pagination + font changes), a
 * colour, the captured text, and an optional attached note. Authoring
 * (select-to-highlight, backlinks) lands in 9.21.4; the contract is
 * frozen here so the preview renderer can paint sample highlights.
 */

import type { LocatorRange } from "./locator";

export enum HighlightColor {
	Yellow = "yellow",
	Green = "green",
	Blue = "blue",
	Pink = "pink",
	Purple = "purple",
}

export type Highlight = {
	id: string;
	bookId: string;
	anchor: LocatorRange;
	color: HighlightColor;
	/** The text that was selected at highlight time — shown in the
	 *  highlights panel + used as a self-healing fallback if a future book
	 *  revision shifts the anchor. */
	quote: string;
	/** Optional attached note (a free-form annotation). */
	note: string;
	createdAt: number;
	updatedAt: number;
};

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
	HighlightColor.Yellow,
	HighlightColor.Green,
	HighlightColor.Blue,
	HighlightColor.Pink,
	HighlightColor.Purple,
];
