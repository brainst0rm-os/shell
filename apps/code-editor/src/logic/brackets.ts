/**
 * Bracket matching (9.7.3). Given a caret offset, find the matching
 * bracket's offset so the editor can highlight the pair. Pure (no DOM);
 * scans outward from a bracket adjacent to the caret, respecting nesting.
 * String / comment awareness is intentionally omitted here (it's a visual
 * aid, not a parser) — the diagnostics linter owns the comment-aware
 * balance check.
 */

const OPEN = "([{";
const CLOSE = ")]}";
const MATCH: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	")": "(",
	"]": "[",
	"}": "{",
};

export type BracketMatch = { open: number; close: number };

/** The bracket offset adjacent to the caret to match from — prefers the
 *  char BEFORE the caret (editor convention), else the char AT the caret. */
function bracketAtCaret(text: string, caret: number): number | null {
	const before = caret - 1;
	if (before >= 0 && isBracket(text[before])) return before;
	if (caret < text.length && isBracket(text[caret])) return caret;
	return null;
}

function isBracket(ch: string | undefined): boolean {
	return ch !== undefined && (OPEN.includes(ch) || CLOSE.includes(ch));
}

/**
 * Find the bracket pair to highlight for a caret at `caret`, or `null` when
 * the caret isn't next to a bracket or the bracket is unmatched. The result
 * is normalized to `{ open, close }` (ascending) regardless of search
 * direction.
 */
export function matchBracket(text: string, caret: number): BracketMatch | null {
	if (typeof text !== "string") return null;
	const pos = bracketAtCaret(text, caret);
	if (pos === null) return null;
	const ch = text[pos] as string;
	const partner = MATCH[ch];
	if (!partner) return null;

	if (OPEN.includes(ch)) {
		const close = scan(text, pos + 1, 1, ch, partner);
		return close === null ? null : { open: pos, close };
	}
	const open = scan(text, pos - 1, -1, ch, partner);
	return open === null ? null : { open, close: pos };
}

/** Walk `step` from `start` counting nesting of `same` until the matching
 *  `target` at depth 0. Returns its offset, or null if unmatched. */
function scan(
	text: string,
	start: number,
	step: number,
	same: string,
	target: string,
): number | null {
	let depth = 0;
	for (let i = start; i >= 0 && i < text.length; i += step) {
		const ch = text[i];
		if (ch === same) depth++;
		else if (ch === target) {
			if (depth === 0) return i;
			depth--;
		}
	}
	return null;
}
