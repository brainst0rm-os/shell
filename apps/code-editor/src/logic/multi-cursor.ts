/**
 * Multi-cursor + column-selection model (9.7.3).
 *
 * The native `<textarea>` owns exactly ONE selection, so secondary
 * cursors are modelled here and painted by the highlight overlay; the
 * pane intercepts edit keys while secondaries exist and routes them
 * through {@link applyMultiCursorEdit}, which produces ONE new buffer
 * string (one `input` dispatch → one Y.Text transaction). The PRIMARY
 * cursor is always index 0 of the set (it mirrors the real textarea
 * selection); the keyboard column-selection path is
 * {@link addCursorVertically} — add-cursor-above/below at a sticky goal
 * column, the classic Cmd+Alt+↑/↓ shape.
 *
 * Pure — no DOM. All offsets are absolute buffer offsets.
 */

export interface CursorRange {
	/** Selection anchor (where the selection started). */
	anchor: number;
	/** Selection head (the caret end). Collapsed cursor ⇔ anchor === head. */
	head: number;
	/** Sticky column for vertical cursor stacking — preserved across
	 *  clamping on shorter lines so a column block stays a column. */
	goalColumn?: number;
}

export enum VerticalDirection {
	Up = "up",
	Down = "down",
}

export enum MultiEditKind {
	Insert = "insert",
	DeleteBackward = "delete-backward",
	DeleteForward = "delete-forward",
}

export interface MultiEdit {
	kind: MultiEditKind;
	/** Inserted text for {@link MultiEditKind.Insert}. */
	text?: string;
}

function rangeMin(c: CursorRange): number {
	return Math.min(c.anchor, c.head);
}

function rangeMax(c: CursorRange): number {
	return Math.max(c.anchor, c.head);
}

/** Sort by position and drop duplicates / overlapping ranges so an edit
 *  never double-applies at one spot. The first (primary) cursor always
 *  survives; later cursors that collide with an earlier one are dropped. */
export function normalizeCursors(cursors: readonly CursorRange[]): CursorRange[] {
	const kept: CursorRange[] = [];
	for (const c of cursors) {
		const overlaps = kept.some(
			(k) =>
				(rangeMin(c) === rangeMin(k) && rangeMax(c) === rangeMax(k)) ||
				(rangeMin(c) < rangeMax(k) && rangeMax(c) > rangeMin(k)),
		);
		if (!overlaps) kept.push(c);
	}
	return kept;
}

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
}

function locate(offset: number, starts: readonly number[]): { line: number; column: number } {
	for (let line = starts.length - 1; line >= 0; line--) {
		const start = starts[line] ?? 0;
		if (offset >= start) return { line, column: offset - start };
	}
	return { line: 0, column: 0 };
}

function lineLength(text: string, line: number, starts: readonly number[]): number {
	const start = starts[line] ?? 0;
	const end = line + 1 < starts.length ? (starts[line + 1] ?? text.length) - 1 : text.length;
	return Math.max(0, end - start);
}

/**
 * Column selection via the keyboard: for each existing cursor, add a
 * collapsed cursor one line above/below at the same goal column
 * (clamped to the target line's length, goal preserved for the next
 * step). Cursors on the first/last line add nothing in that direction.
 */
export function addCursorVertically(
	text: string,
	cursors: readonly CursorRange[],
	direction: VerticalDirection,
): CursorRange[] {
	const starts = lineStarts(text);
	const added: CursorRange[] = [];
	for (const c of cursors) {
		const pos = locate(c.head, starts);
		const goal = c.goalColumn ?? pos.column;
		const targetLine = direction === VerticalDirection.Up ? pos.line - 1 : pos.line + 1;
		if (targetLine < 0 || targetLine >= starts.length) continue;
		const column = Math.min(goal, lineLength(text, targetLine, starts));
		const offset = (starts[targetLine] ?? 0) + column;
		added.push({ anchor: offset, head: offset, goalColumn: goal });
	}
	return normalizeCursors([...cursors, ...added]);
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** The word range around `offset`, or null when the offset touches no
 *  word character. */
export function wordRangeAt(text: string, offset: number): { from: number; to: number } | null {
	const probe = (i: number): boolean => i >= 0 && i < text.length && WORD_CHAR.test(text.charAt(i));
	let from = offset;
	let to = offset;
	if (probe(offset)) to = offset + 1;
	else if (probe(offset - 1)) from = offset - 1;
	else return null;
	while (probe(from - 1)) from--;
	while (probe(to)) to++;
	return { from, to };
}

/**
 * Cmd+D semantics: with a collapsed primary, select the word under the
 * caret; otherwise add a selection over the next occurrence (after the
 * last cursor, wrapping) of the primary's selected text. Case-sensitive
 * exact match (the editor-classic behaviour). Returns the cursors
 * unchanged when nothing can be added.
 */
export function selectNextOccurrence(text: string, cursors: readonly CursorRange[]): CursorRange[] {
	const primary = cursors[0];
	if (!primary) return [...cursors];
	if (primary.anchor === primary.head) {
		const word = wordRangeAt(text, primary.head);
		if (!word) return [...cursors];
		return [{ anchor: word.from, head: word.to }, ...cursors.slice(1)];
	}
	const term = text.slice(rangeMin(primary), rangeMax(primary));
	if (term.length === 0) return [...cursors];
	const searchFrom = Math.max(...cursors.map(rangeMax));
	let idx = text.indexOf(term, searchFrom);
	if (idx < 0) idx = text.indexOf(term);
	if (idx < 0) return [...cursors];
	const candidate: CursorRange = { anchor: idx, head: idx + term.length };
	const next = normalizeCursors([...cursors, candidate]);
	return next;
}

/**
 * Apply one edit at EVERY cursor, producing the new buffer + the new
 * (collapsed) cursor set, index-aligned with the input so the caller
 * can keep cursor 0 as the textarea's primary selection.
 */
export function applyMultiCursorEdit(
	text: string,
	cursors: readonly CursorRange[],
	edit: MultiEdit,
): { text: string; cursors: CursorRange[] } {
	const order = cursors
		.map((cursor, index) => ({ cursor, index }))
		.sort((a, b) => rangeMin(a.cursor) - rangeMin(b.cursor));
	let out = "";
	let docCursor = 0;
	const results: { index: number; caret: number }[] = [];
	for (const { cursor, index } of order) {
		let from = rangeMin(cursor);
		let to = rangeMax(cursor);
		if (edit.kind === MultiEditKind.DeleteBackward && from === to) from = Math.max(0, from - 1);
		if (edit.kind === MultiEditKind.DeleteForward && from === to) to = Math.min(text.length, to + 1);
		// Defensive: an expanded delete must never reach back across the
		// region an earlier cursor already consumed.
		from = Math.max(from, docCursor);
		to = Math.max(to, from);
		const insert = edit.kind === MultiEditKind.Insert ? (edit.text ?? "") : "";
		out += text.slice(docCursor, from) + insert;
		results.push({ index, caret: out.length });
		docCursor = to;
	}
	out += text.slice(docCursor);
	const next: CursorRange[] = new Array(results.length);
	for (const r of results) next[r.index] = { anchor: r.caret, head: r.caret };
	return { text: out, cursors: next };
}
