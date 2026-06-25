/**
 * B11.1 — unicode "typing shortcuts": an ASCII sequence rewrites to its
 * unicode glyph as you type the completing character (`->` → →, `...` → …).
 *
 * Built as `@lexical/markdown` `TextMatchTransformer`s added to the editor's
 * `MarkdownShortcutPlugin` transformer list (the same proven on-type pipeline
 * the equation shortcut uses) — NOT a bespoke keystroke handler. Each
 * transformer fires on its trigger char, matches the ASCII run at the caret,
 * and splices in the glyph; the markdown plugin owns the timing + undo step.
 *
 * The replacement table is the documented v1 set; it stays small + pure so a
 * new entry is one row + one test. `rewriteTrailingShortcut` is the pure core
 * (no Lexical) so the mapping is exhaustively unit-testable on its own.
 */

import type { TextMatchTransformer } from "@lexical/markdown";
import type { TextNode } from "lexical";

/** One ASCII→glyph rule. `ascii` is the literal typed run; `glyph` the
 *  single (or short) unicode replacement. */
export type TypingShortcut = { ascii: string; glyph: string };

/** The v1 set (docs/editing — B11.1). Order is irrelevant: each becomes its
 *  own transformer keyed by its trailing trigger char. */
export const TYPING_SHORTCUTS: readonly TypingShortcut[] = [
	{ ascii: "->", glyph: "→" },
	{ ascii: "=>", glyph: "⇒" },
	{ ascii: "!=", glyph: "≠" },
	{ ascii: ">=", glyph: "≥" },
	{ ascii: "--", glyph: "—" },
	{ ascii: "...", glyph: "…" },
	{ ascii: "(tm)", glyph: "™" },
];

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure core: if `text` ends with one of the shortcut ASCII runs, return the
 * text with that trailing run replaced by its glyph (and which rule fired);
 * otherwise `null`. Longest match wins so `-->` can't be shadowed by `--`
 * before `->` is considered (the table has no such overlap today, but the
 * rule keeps it safe). Used both by the transformers and the tests.
 */
export function rewriteTrailingShortcut(
	text: string,
): { text: string; shortcut: TypingShortcut } | null {
	let best: TypingShortcut | null = null;
	for (const s of TYPING_SHORTCUTS) {
		if (text.endsWith(s.ascii) && (!best || s.ascii.length > best.ascii.length)) best = s;
	}
	if (!best) return null;
	return { text: text.slice(0, -best.ascii.length) + best.glyph, shortcut: best };
}

/** Build the markdown text-match transformer for one shortcut. The trigger is
 *  the run's last char; the anchored `regExp` matches the run ending at the
 *  caret; `replace` splices the run for its glyph in place. Glyphs don't
 *  round-trip back to ASCII, so `export`/`importRegExp` are inert. */
function makeTransformer({ ascii, glyph }: TypingShortcut): TextMatchTransformer {
	const trigger = ascii[ascii.length - 1] as string;
	const pattern = new RegExp(`${escapeRegExp(ascii)}$`);
	return {
		dependencies: [],
		export: () => null,
		importRegExp: pattern,
		regExp: pattern,
		replace: (textNode: TextNode, match: RegExpMatchArray) => {
			const start = match.index ?? 0;
			textNode.spliceText(start, match[0].length, glyph, true);
		},
		trigger,
		type: "text-match",
	};
}

/** The transformer list to append to `MarkdownShortcutPlugin`'s transformers. */
export const UNICODE_SHORTCUT_TRANSFORMERS: readonly TextMatchTransformer[] =
	TYPING_SHORTCUTS.map(makeTransformer);
