/**
 * Pure `@`-mention detection for a plain `<textarea>` composer. Given the text +
 * caret offset, find the mention token being typed (the run after the most
 * recent `@` that the caret is inside) so the host can drive a typeahead off it.
 * No DOM, no React — unit-tested in isolation; the wiring lives in
 * `use-mention-typeahead.ts`.
 */

/** The active mention being typed: the query text after `@` and the index of the
 *  `@` itself (so the caller can excise the `@query` run when a choice commits). */
export type MentionMatch = {
	query: string;
	/** Offset of the triggering `@`. */
	start: number;
};

const MENTION_TRIGGER = "@";
/** A mention query runs until whitespace; cap it so a pathological run can't
 *  drive an unbounded search. */
export const MENTION_QUERY_MAX = 80;

function isSpace(ch: string | undefined): boolean {
	return ch === undefined || /\s/.test(ch);
}

/**
 * Detect the mention token the caret sits in, or `null` when there is none.
 * The trigger fires only when the `@` is at the start of the text or preceded by
 * whitespace, so an email address (`a@b`) never opens the typeahead. The query
 * ends at the caret; a whitespace between the `@` and the caret closes the token.
 */
export function detectMention(text: string, caret: number): MentionMatch | null {
	if (caret < 0 || caret > text.length) return null;
	for (let i = caret - 1; i >= 0; i--) {
		const ch = text[i];
		if (ch === MENTION_TRIGGER) {
			const before = i > 0 ? text[i - 1] : undefined;
			if (!isSpace(before)) return null;
			const query = text.slice(i + 1, caret);
			if (query.length > MENTION_QUERY_MAX) return null;
			return { query, start: i };
		}
		if (isSpace(ch)) return null;
	}
	return null;
}

/**
 * Excise the typed `@query` run when a candidate commits — the chip carries the
 * reference, so the literal text is removed. Returns the new text + the caret
 * position (where the `@` was).
 */
export function clearMentionToken(
	text: string,
	match: MentionMatch,
	caret: number,
): { text: string; caret: number } {
	const end = Math.min(Math.max(caret, match.start), text.length);
	return { text: text.slice(0, match.start) + text.slice(end), caret: match.start };
}
