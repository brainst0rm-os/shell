/**
 * Pure trigger logic for the `:`-shortcode emoji typeahead (B11.1). Kept in
 * its own module (mirroring `mention-ops`) so the detection unit-tests without
 * the editor surface or jsdom.
 */

export type EmojiTrigger = {
	/** Offset of the opening `:` in the text node. */
	triggerOffset: number;
	/** Shortcode query between `:` and the caret. */
	query: string;
};

const MAX_QUERY_LENGTH = 32;

/** Walk back from the caret for a `:` that opens a shortcode context — the
 *  `:` must sit at the start of the block or after whitespace/punctuation (so
 *  `12:30` / `http://` don't pop the menu), and the query between it and the
 *  caret must be shortcode characters (`a-zA-Z0-9_+-`). Returns null when the
 *  caret isn't inside one.
 *
 *  `allowEmpty` (set when the user explicitly opened the picker via the
 *  `Mod+Shift+E` chord) accepts a bare `:` with no query yet, so the picker
 *  can show a browse list before the first keystroke. Off by default so a
 *  `:` typed mid-prose doesn't pop the menu on its own. */
export function detectEmojiTrigger(
	text: string,
	caret: number,
	allowEmpty = false,
): EmojiTrigger | null {
	if (caret < 0 || caret > text.length) return null;
	for (let i = caret - 1; i >= 0; i--) {
		const ch = text.charAt(i);
		if (ch === ":") {
			const before = i === 0 ? "" : text.charAt(i - 1);
			if (!isEmojiBoundary(before)) return null;
			const query = text.slice(i + 1, caret);
			if (query.length > MAX_QUERY_LENGTH) return null;
			if (query.length === 0) return allowEmpty ? { triggerOffset: i, query } : null;
			if (!/^[a-zA-Z0-9_+-]+$/.test(query)) return null;
			return { triggerOffset: i, query };
		}
		if (/[\s\n]/.test(ch)) return null;
	}
	return null;
}

function isEmojiBoundary(ch: string): boolean {
	if (ch === "") return true;
	if (/\s/.test(ch)) return true;
	return /[([{<,;!?"'`-]/.test(ch);
}
