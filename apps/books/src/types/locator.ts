/**
 * `Locator` — a CFI-style stable anchor into a book's content stream.
 *
 * A book is an ordered list of *spine items* (EPUB chapters / PDF pages);
 * each spine item is reflowable text. A locator pins a position
 * independent of the current font size / viewport (which change where
 * page breaks fall), so a reading position or a highlight survives
 * re-pagination — the long-term keystone the throwaway preview renderer
 * is built on. The serialized wire form mirrors the EPUB CFI grammar
 * loosely (`/<spineIndex>:<charOffset>`) so the real epub.js parser in
 * 9.21.2 can map true CFIs onto the same shape without a model change.
 */

/** A single anchored point in the content stream. */
export type Locator = {
	/** 0-based index into the book's spine (chapter / page order). */
	spineIndex: number;
	/** 0-based character offset within that spine item's plain text. */
	charOffset: number;
};

/** A contiguous span (start..end) — what a `Highlight` anchors over. A
 *  collapsed range (`start` deep-equals `end`) is a caret, used for a
 *  reading position. */
export type LocatorRange = {
	start: Locator;
	end: Locator;
};

const CFI_PREFIX = "bkcfi:";

export function makeLocator(spineIndex: number, charOffset: number): Locator {
	return { spineIndex, charOffset };
}

/** Total order over locators: spine first, then char offset. */
export function compareLocators(a: Locator, b: Locator): number {
	if (a.spineIndex !== b.spineIndex) return a.spineIndex - b.spineIndex;
	return a.charOffset - b.charOffset;
}

export function locatorsEqual(a: Locator, b: Locator): boolean {
	return compareLocators(a, b) === 0;
}

/** Normalize a range so `start <= end` (a backward selection is swapped). */
export function normalizeRange(range: LocatorRange): LocatorRange {
	return compareLocators(range.start, range.end) <= 0
		? range
		: { start: range.end, end: range.start };
}

export function rangeIsCollapsed(range: LocatorRange): boolean {
	return locatorsEqual(range.start, range.end);
}

/** Serialize to the CFI-style wire form: `bkcfi:/2:140`. */
export function serializeLocator(locator: Locator): string {
	return `${CFI_PREFIX}/${locator.spineIndex}:${locator.charOffset}`;
}

export function parseLocator(raw: string): Locator | null {
	if (!raw.startsWith(CFI_PREFIX)) return null;
	const body = raw.slice(CFI_PREFIX.length);
	const match = /^\/(\d+):(\d+)$/.exec(body);
	if (!match || match[1] === undefined || match[2] === undefined) return null;
	return makeLocator(Number(match[1]), Number(match[2]));
}

export function serializeRange(range: LocatorRange): string {
	return `${serializeLocator(range.start)},${serializeLocator(range.end)}`;
}

export function parseRange(raw: string): LocatorRange | null {
	const comma = raw.indexOf(",");
	if (comma === -1) return null;
	const start = parseLocator(raw.slice(0, comma));
	const end = parseLocator(raw.slice(comma + 1));
	if (!start || !end) return null;
	return { start, end };
}
