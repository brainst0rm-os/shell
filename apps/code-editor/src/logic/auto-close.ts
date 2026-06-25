/**
 * Auto-close bracket pairs (9.7.3) — pure buffer transforms.
 *
 * The editing semantics of typing a bracket/quote, typing its closer, or
 * backspacing an empty pair. Like `line-ops.ts` these are caret-arithmetic
 * that only earns trust under tests, so the logic is pure and the code-pane
 * keydown handler just applies the result. Each entry point returns the next
 * `{ text, selStart, selEnd }` when it handled the keystroke, or `null` to
 * let the textarea's native input proceed unchanged.
 */

import type { BufferSelection } from "./line-ops";

/** Opener → closer. Quotes are self-closing (same char both sides). */
const PAIRS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	'"': '"',
	"'": "'",
	"`": "`",
};

const OPENERS = new Set(Object.keys(PAIRS));
const CLOSERS = new Set(Object.values(PAIRS));
const QUOTES = new Set(['"', "'", "`"]);

export function isAutoPairOpener(ch: string): boolean {
	return OPENERS.has(ch);
}

export function isAutoPairCloser(ch: string): boolean {
	return CLOSERS.has(ch);
}

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Typing an opener. With a non-empty selection the selection is wrapped
 * (selection preserved around the original text). With a collapsed caret a
 * matching closer is inserted and the caret lands between the pair.
 *
 * Quote heuristics avoid fighting ordinary typing: a quote is NOT
 * auto-closed when it abuts a word character (so `don't` stays a single
 * quote, and a closing quote after a word isn't doubled), and an opener
 * sitting directly before a word character is left alone (you're typing
 * before existing text, not opening an empty pair).
 */
export function autoCloseOnOpen(input: BufferSelection, opener: string): BufferSelection | null {
	const closer = PAIRS[opener];
	if (closer === undefined) return null;
	const { text, selStart, selEnd } = input;
	const a = Math.min(selStart, selEnd);
	const b = Math.max(selStart, selEnd);

	if (b > a) {
		const wrapped = `${text.slice(0, a)}${opener}${text.slice(a, b)}${closer}${text.slice(b)}`;
		return { text: wrapped, selStart: selStart + 1, selEnd: selEnd + 1 };
	}

	const prev = a > 0 ? text[a - 1] : undefined;
	const next = text[a];
	if (QUOTES.has(opener) && (isWordChar(prev) || opener === next)) return null;
	if (isWordChar(next)) return null;

	const inserted = `${text.slice(0, a)}${opener}${closer}${text.slice(a)}`;
	return { text: inserted, selStart: a + 1, selEnd: a + 1 };
}

/**
 * Typing a closer that already sits directly after the caret "types over"
 * it — the caret steps past the existing closer instead of inserting a
 * duplicate. Only fires on a collapsed caret; otherwise returns `null`.
 */
export function autoCloseOnClose(input: BufferSelection, closer: string): BufferSelection | null {
	if (!CLOSERS.has(closer)) return null;
	const { text, selStart, selEnd } = input;
	if (selStart !== selEnd) return null;
	if (text[selStart] !== closer) return null;
	return { text, selStart: selStart + 1, selEnd: selStart + 1 };
}

/**
 * Backspacing with a collapsed caret sitting between a freshly-opened empty
 * pair (`(|)`, `"|"`, …) removes both characters at once.
 */
export function autoCloseOnBackspace(input: BufferSelection): BufferSelection | null {
	const { text, selStart, selEnd } = input;
	if (selStart !== selEnd || selStart === 0) return null;
	const prev = text[selStart - 1];
	const next = text[selStart];
	if (prev === undefined || PAIRS[prev] !== next) return null;
	const result = text.slice(0, selStart - 1) + text.slice(selStart + 1);
	return { text: result, selStart: selStart - 1, selEnd: selStart - 1 };
}
