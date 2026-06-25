/**
 * Pure view-model for the code pane. The renderer is plain-DOM in this
 * preview drop — a real syntax highlighter (Shiki, shared with Preview
 * 9.20.4) is a deliberately-deferred rung per [[avoid-blocking-on-deps]]
 * (`shiki` isn't a workspace dep yet). These helpers are the keystone
 * that survives that swap: the gutter width + line split + language
 * label don't change when token spans land inside each line.
 */

import { LanguageKey } from "../types/code-file";

export interface CodeLine {
	/** 1-based line number shown in the gutter. */
	number: number;
	/** The line's text with no trailing newline. */
	text: string;
}

/** Split buffer text into gutter-numbered lines. A trailing newline
 *  does NOT synthesise a phantom empty last line beyond the one the
 *  editor shows, but an empty buffer is still one (empty) line so the
 *  caret has somewhere to sit. */
export function toCodeLines(content: string): CodeLine[] {
	if (content.length === 0) return [{ number: 1, text: "" }];
	const parts = content.split("\n");
	return parts.map((text, i) => ({ number: i + 1, text }));
}

/** Monospace gutter width in `ch` units — wide enough for the largest
 *  line number plus one unit of breathing room, floored at 2 so a
 *  short file's gutter doesn't look cramped. */
export function gutterWidthCh(lineCount: number): number {
	const digits = Math.max(1, String(Math.max(1, lineCount)).length);
	return Math.max(2, digits) + 1;
}

const LANGUAGE_LABELS: Readonly<Record<LanguageKey, string>> = Object.freeze({
	[LanguageKey.TypeScript]: "TypeScript",
	[LanguageKey.JavaScript]: "JavaScript",
	[LanguageKey.TSX]: "TSX",
	[LanguageKey.JSX]: "JSX",
	[LanguageKey.JSON]: "JSON",
	[LanguageKey.JSONC]: "JSON with Comments",
	[LanguageKey.HTML]: "HTML",
	[LanguageKey.CSS]: "CSS",
	[LanguageKey.Markdown]: "Markdown",
	[LanguageKey.Python]: "Python",
	[LanguageKey.Rust]: "Rust",
	[LanguageKey.Go]: "Go",
	[LanguageKey.Java]: "Java",
	[LanguageKey.Shell]: "Shell",
	[LanguageKey.YAML]: "YAML",
	[LanguageKey.TOML]: "TOML",
	[LanguageKey.SQL]: "SQL",
	[LanguageKey.Dockerfile]: "Dockerfile",
	[LanguageKey.PlainText]: "Plain Text",
	[LanguageKey.Unknown]: "Plain Text",
});

export function languageLabel(language: LanguageKey): string {
	return LANGUAGE_LABELS[language] ?? LANGUAGE_LABELS[LanguageKey.PlainText];
}

/** The basename shown in the file list — last path segment, or the
 *  whole string when there's no separator. Never empty (a trailing
 *  slash falls back to the full path). */
export function fileName(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	if (lastSlash < 0) return normalized;
	const tail = normalized.slice(lastSlash + 1);
	return tail.length > 0 ? tail : normalized;
}
