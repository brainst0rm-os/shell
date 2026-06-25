/**
 * Built-in lightweight diagnostics (9.7.6). A real LSP is the deeper
 * follow-on; v1 ships a fast, language-agnostic linter that catches the
 * mechanical problems an editor can find without a parser — unbalanced
 * brackets, mixed tabs/spaces in leading indentation, and trailing
 * whitespace. Pure (no DOM); the renderer paints the problem list + jumps
 * to the reported 1-based line.
 */

import { LanguageKey } from "../types/code-file";

export enum DiagnosticSeverity {
	Error = "error",
	Warning = "warning",
}

export enum DiagnosticCode {
	UnmatchedBracket = "unmatched-bracket",
	UnclosedBracket = "unclosed-bracket",
	MixedIndent = "mixed-indent",
	TrailingWhitespace = "trailing-whitespace",
}

export type Diagnostic = {
	severity: DiagnosticSeverity;
	code: DiagnosticCode;
	/** 1-based line the problem sits on. */
	line: number;
	/** 0-based column where the underline starts within the line. Omitted
	 *  when the problem has no precise span — the squiggle then underlines
	 *  the whole line's content (9.7.6 inline squiggles). */
	column?: number;
	/** Length (in characters) of the underlined span. Pairs with `column`;
	 *  omitted alongside it. */
	length?: number;
	/** Interpolation data for the `code`'s catalog message (e.g. the offending
	 *  bracket `ch`). The localised message is built in the renderer (the list
	 *  builder maps `code` → a catalog key and feeds these params) so no
	 *  English prose is baked at construction. */
	params?: Record<string, string>;
};

const OPEN = "([{";
const CLOSE = ")]}";
const PAIR: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Languages whose brackets we balance-check. Skipped for prose / data
 *  formats where unmatched brackets are normal (Markdown, plain text). */
const BRACKET_LANGUAGES = new Set<LanguageKey>([
	LanguageKey.TypeScript,
	LanguageKey.JavaScript,
	LanguageKey.TSX,
	LanguageKey.JSX,
	LanguageKey.JSON,
	LanguageKey.JSONC,
	LanguageKey.CSS,
	LanguageKey.Rust,
	LanguageKey.Go,
	LanguageKey.Java,
]);

/**
 * Lint `content`. Returns diagnostics sorted by line then severity. A
 * language hint scopes the bracket check (off for prose). Never throws;
 * an empty buffer yields `[]`.
 */
export function lintCode(content: string, language: LanguageKey): Diagnostic[] {
	const out: Diagnostic[] = [];
	if (typeof content !== "string" || content.length === 0) return out;
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const lineNo = i + 1;
		// Trailing whitespace (ignore an otherwise-blank line — that's noise).
		const trailing = line.match(/[ \t]+$/);
		if (trailing && line.trimEnd().length > 0) {
			out.push({
				severity: DiagnosticSeverity.Warning,
				code: DiagnosticCode.TrailingWhitespace,
				line: lineNo,
				column: trailing.index ?? 0,
				length: trailing[0].length,
			});
		}
		// Mixed tabs + spaces in the leading indentation.
		const indent = line.match(/^[ \t]*/)?.[0] ?? "";
		if (indent.includes(" ") && indent.includes("\t")) {
			out.push({
				severity: DiagnosticSeverity.Warning,
				code: DiagnosticCode.MixedIndent,
				line: lineNo,
				column: 0,
				length: indent.length,
			});
		}
	}

	if (BRACKET_LANGUAGES.has(language)) {
		out.push(...bracketDiagnostics(content));
	}

	out.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
	return out;
}

/** Balance-check brackets, ignoring those inside strings + line/block
 *  comments (a deliberately small scanner — good enough to flag a genuine
 *  imbalance without a full parser). Reports the line of the offending
 *  bracket (an unmatched close) or the last unclosed open. */
function bracketDiagnostics(content: string): Diagnostic[] {
	const stack: { ch: string; line: number; column: number }[] = [];
	const out: Diagnostic[] = [];
	let line = 1;
	let lineStart = 0;
	let inString: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < content.length; i++) {
		const ch = content[i] as string;
		const next = content[i + 1];
		if (ch === "\n") {
			line++;
			lineStart = i + 1;
			inLineComment = false;
			continue;
		}
		if (inLineComment) continue;
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			if (ch === "\\") i++;
			else if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			inLineComment = true;
			i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			i++;
			continue;
		}
		if (OPEN.includes(ch)) {
			stack.push({ ch, line, column: i - lineStart });
		} else if (CLOSE.includes(ch)) {
			const top = stack.pop();
			if (!top || top.ch !== PAIR[ch]) {
				out.push({
					severity: DiagnosticSeverity.Error,
					code: DiagnosticCode.UnmatchedBracket,
					line,
					column: i - lineStart,
					length: 1,
					params: { ch },
				});
			}
		}
	}
	for (const unclosed of stack) {
		out.push({
			severity: DiagnosticSeverity.Error,
			code: DiagnosticCode.UnclosedBracket,
			line: unclosed.line,
			column: unclosed.column,
			length: 1,
			params: { ch: unclosed.ch },
		});
	}
	return out;
}

/** An absolute-offset underline span for a diagnostic — what the overlay
 *  paints as an inline squiggle (9.7.6). `from`/`to` are buffer offsets. */
export type DiagnosticRange = {
	from: number;
	to: number;
	severity: DiagnosticSeverity;
};

/**
 * Convert line-addressed {@link Diagnostic}s into absolute-offset
 * {@link DiagnosticRange}s for the inline squiggle overlay. A diagnostic
 * with a `column`/`length` underlines exactly that span; without one it
 * underlines the line's content (first non-whitespace char to line end, so
 * leading indentation isn't squiggled). Zero-width spans are dropped. Pure;
 * never throws — out-of-range lines are skipped.
 */
export function diagnosticRanges(
	content: string,
	diagnostics: readonly Diagnostic[],
): DiagnosticRange[] {
	if (typeof content !== "string" || content.length === 0) return [];
	const lineStarts = [0];
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
	}
	const out: DiagnosticRange[] = [];
	for (const d of diagnostics) {
		const lineStart = lineStarts[d.line - 1];
		if (lineStart === undefined) continue;
		const lineEnd =
			d.line < lineStarts.length ? (lineStarts[d.line] ?? content.length) - 1 : content.length;
		const lineText = content.slice(lineStart, lineEnd);
		let from: number;
		let to: number;
		if (d.column !== undefined && d.length !== undefined) {
			from = lineStart + d.column;
			to = from + d.length;
		} else {
			// Whole-line span: skip the leading indentation so the squiggle
			// tracks the content, not the gutter whitespace.
			const lead = lineText.match(/^\s*/)?.[0].length ?? 0;
			from = lineStart + lead;
			to = lineEnd;
		}
		from = Math.max(lineStart, Math.min(from, lineEnd));
		to = Math.max(from, Math.min(to, lineEnd));
		if (to > from) out.push({ from, to, severity: d.severity });
	}
	return out;
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): {
	errors: number;
	warnings: number;
} {
	let errors = 0;
	let warnings = 0;
	for (const d of diagnostics) {
		if (d.severity === DiagnosticSeverity.Error) errors++;
		else warnings++;
	}
	return { errors, warnings };
}
