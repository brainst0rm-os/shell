/**
 * Code folding model (9.7.3) — indentation-based foldable regions plus
 * the doc-text ⇄ view-text mapping the textarea surface needs.
 *
 * The pane's `<textarea>` shows exactly one string, so a fold is a VIEW
 * transformation: hidden lines are removed from the view text and the
 * gutter numbers skip them. Editing while folded is deliberately not
 * supported on the textarea surface (that's CodeMirror-view territory)
 * — the pane flips the textarea read-only while any fold is active and
 * the first edit intent unfolds everything with the caret mapped back
 * to doc space ({@link viewToDoc}). Pure — no DOM.
 */

/** A foldable region. Lines are 0-based; the header line stays visible,
 *  lines `start..end` (inclusive) hide when folded. */
export interface FoldRegion {
	header: number;
	start: number;
	end: number;
}

function indentWidth(line: string, tabSize = 4): number | null {
	if (line.trim().length === 0) return null;
	let width = 0;
	for (const ch of line) {
		if (ch === " ") width += 1;
		else if (ch === "\t") width += tabSize - (width % tabSize);
		else break;
	}
	return width;
}

/**
 * Indentation-based foldable regions (the same heuristic CodeMirror's
 * indent fold service uses): a line is a fold header when the next
 * non-blank line is deeper-indented; the region runs to the last
 * consecutive line that stays deeper (trailing blanks excluded).
 */
export function foldableRegions(text: string): FoldRegion[] {
	const lines = text.split("\n");
	const indents = lines.map((l) => indentWidth(l));
	const regions: FoldRegion[] = [];
	for (let i = 0; i < lines.length; i++) {
		const headerIndent = indents[i];
		if (headerIndent === null || headerIndent === undefined) continue;
		let probe = i + 1;
		while (probe < lines.length && indents[probe] === null) probe++;
		const childIndent = probe < lines.length ? indents[probe] : null;
		if (childIndent === null || childIndent === undefined || childIndent <= headerIndent) continue;
		let end = probe;
		for (let j = probe + 1; j < lines.length; j++) {
			const indent = indents[j];
			if (indent === null || indent === undefined) continue;
			if (indent <= headerIndent) break;
			end = j;
		}
		regions.push({ header: i, start: i + 1, end });
	}
	return regions;
}

/** The region headed by `line`, or null. */
export function regionAtHeader(regions: readonly FoldRegion[], line: number): FoldRegion | null {
	return regions.find((r) => r.header === line) ?? null;
}

/** The innermost region containing `line` (header or body), or null —
 *  the fold-at-caret target. */
export function regionContaining(regions: readonly FoldRegion[], line: number): FoldRegion | null {
	let best: FoldRegion | null = null;
	for (const r of regions) {
		if (line < r.header || line > r.end) continue;
		if (!best || r.header > best.header) best = r;
	}
	return best;
}

export interface FoldView {
	/** The view text — doc text minus the hidden lines. */
	text: string;
	/** 0-based DOC line number for each VIEW line (gutter numbering). */
	docLines: number[];
	/** View lines that end a fold (the header rows carrying the ⋯ badge). */
	foldedViewLines: number[];
}

/** Resolve the active fold set against the current regions: stale
 *  headers (line vanished / region gone) drop out; nested folds inside
 *  an already-hidden range are kept but have no extra effect. */
export function activeFoldRegions(
	regions: readonly FoldRegion[],
	foldedHeaders: ReadonlySet<number>,
): FoldRegion[] {
	return regions.filter((r) => foldedHeaders.has(r.header));
}

/**
 * Build the folded view of `text`. Hidden = every line inside a folded
 * region's `start..end` span. Pure function of (text, folds).
 */
export function buildFoldView(text: string, folded: readonly FoldRegion[]): FoldView {
	const lines = text.split("\n");
	const hidden = new Set<number>();
	const headerSet = new Set<number>();
	for (const r of folded) {
		headerSet.add(r.header);
		for (let l = r.start; l <= r.end && l < lines.length; l++) hidden.add(l);
	}
	const viewLines: string[] = [];
	const docLines: number[] = [];
	const foldedViewLines: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (hidden.has(i)) continue;
		if (headerSet.has(i)) foldedViewLines.push(viewLines.length);
		viewLines.push(lines[i] ?? "");
		docLines.push(i);
	}
	return { text: viewLines.join("\n"), docLines, foldedViewLines };
}

/**
 * Map a VIEW offset back to the DOC offset (unfold-on-edit caret
 * restore). Offsets clamp into range. The mapping walks line-by-line:
 * a view position on view line `v` at column `c` lands on doc line
 * `docLines[v]` at the same column.
 */
export function viewToDoc(view: FoldView, docText: string, viewOffset: number): number {
	const clamped = Math.max(0, Math.min(viewOffset, view.text.length));
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < clamped; i++) {
		if (view.text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	const column = clamped - lineStart;
	const docLine = view.docLines[line] ?? 0;
	let docLineStart = 0;
	let seen = 0;
	for (let i = 0; i < docText.length && seen < docLine; i++) {
		if (docText.charCodeAt(i) === 10) {
			seen++;
			docLineStart = i + 1;
		}
	}
	return Math.min(docLineStart + column, docText.length);
}
