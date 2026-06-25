/**
 * Pure offset ↔ line/column converters. Long-term keystone — the
 * renderer's cursor model, hover-target detection, and MCP-citation
 * inline (SH-14) all dispatch off these.
 */

export interface LinePosition {
	/** 1-based line number. */
	line: number;
	/** 1-based column number (counts characters in the source line; no
	 *  tab-stop expansion). */
	column: number;
}

/**
 * Convert a UTF-16 offset within `content` into 1-based line + column.
 * Out-of-range offsets clamp to the start (≤0) or end (>length) of the
 * file.
 */
export function offsetToLineColumn(content: string, offset: number): LinePosition {
	if (offset <= 0) return { line: 1, column: 1 };
	const cap = Math.min(offset, content.length);
	let line = 1;
	let lastNewline = -1;
	for (let i = 0; i < cap; i++) {
		if (content.charCodeAt(i) === 10 /* \n */) {
			line++;
			lastNewline = i;
		}
	}
	return { line, column: cap - lastNewline };
}

/**
 * Convert 1-based line/column to a UTF-16 offset. Out-of-range positions
 * clamp; missing column defaults to 1. `Number.isNaN` / negative inputs
 * fall back to start-of-file.
 */
export function lineColumnToOffset(content: string, pos: LinePosition): number {
	if (!Number.isFinite(pos.line) || pos.line <= 0) return 0;
	const targetLine = Math.floor(pos.line);
	const targetColumn = Math.max(1, Math.floor(pos.column || 1));
	let line = 1;
	let offset = 0;
	while (offset < content.length && line < targetLine) {
		if (content.charCodeAt(offset) === 10) line++;
		offset++;
	}
	if (line < targetLine) return content.length;
	const lineStart = offset;
	let column = 1;
	while (offset < content.length && content.charCodeAt(offset) !== 10 && column < targetColumn) {
		offset++;
		column++;
	}
	return Math.min(offset, content.length) || lineStart;
}

/**
 * Count the lines in a source string. Counts a trailing `\n` as ending
 * a complete line (so "a\n" has 1 line). Empty string is 1 (matches what
 * an editor shows on a brand-new buffer).
 */
export function countLines(content: string): number {
	if (content.length === 0) return 1;
	let lines = 1;
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10) lines++;
	}
	if (content.charCodeAt(content.length - 1) === 10) lines--;
	return Math.max(1, lines);
}
