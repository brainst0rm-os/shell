/**
 * Highlight overlay — renders Shiki-produced token spans into a `<pre>`
 * positioned UNDER a transparent-text `<textarea>` so the user sees
 * highlighted code while still typing into a normal text input (the
 * classic textarea-overlay-syntax-highlight pattern).
 *
 * Why this shape, not a contenteditable code editor?
 *  - The native textarea owns the caret, selection, IME composition,
 *    spellcheck, and accessibility. A contenteditable would have to
 *    re-implement every one of those for a single-purpose editor.
 *  - Shiki's tokens already paint disjoint spans — the overlay just
 *    binds them to the same monospace metrics as the textarea, so the
 *    spans visually overlay each character cell.
 *
 * The overlay scrolls with the textarea (1:1 scroll-sync). The
 * `whitespace: pre` rule preserves indentation exactly; line wrap is
 * off — code needs column fidelity (same stance as the preview app's
 * code renderer).
 */

import type { ThemedToken } from "shiki/core";
import type { BracketMatch } from "../logic/brackets";
import type { CitationSpan } from "../logic/citation-scan";
import { type DiagnosticRange, DiagnosticSeverity } from "../logic/diagnostics";

/** Width (in character columns) of one indent level, mirroring
 *  `logic/indent-guides.ts`'s default. A guide at level `n` is drawn at
 *  `n * GUIDE_INDENT_COLUMNS` character cells from the line's content
 *  start, so the guides land between indentation steps. */
export const GUIDE_INDENT_COLUMNS = 2;

/** A decorated range over the painted buffer, absolute offsets. */
export interface OffsetRange {
	from: number;
	to: number;
}

/** A secondary cursor painted by the overlay (9.7.3 multi-cursor): a
 *  (possibly collapsed) selection plus the caret position inside it. */
export interface ExtraCursor extends OffsetRange {
	caret: number;
}

export interface HighlightOverlayHandle {
	/** Replace the rendered tokens. `null` means "no highlighting" — the
	 *  overlay paints unstyled lines so the gutter still lines up. */
	setTokens(tokens: ThemedToken[][] | null, fallbackText: string): void;
	/** Set the per-line indent-guide depths (9.7.3). `depths[i]` is the
	 *  number of vertical guide lines to draw on line `i`; an empty array
	 *  clears all guides. Idempotent per call. */
	setIndentGuides(depths: readonly number[]): void;
	/** Highlight the matched bracket pair (9.7.3). Pass the `{ open, close }`
	 *  buffer offsets (from `matchBracket`) to draw a marker over each
	 *  bracket character; `null` clears the highlight. Idempotent per call. */
	setBracketMatch(match: BracketMatch | null): void;
	/** Decorate the find matches (B9.3) — every match gets a soft box,
	 *  the active one a strong outline. Empty array clears. Idempotent. */
	setFindMatches(matches: readonly OffsetRange[], active: OffsetRange | null): void;
	/** Paint the secondary multi-cursor carets + selections (9.7.3).
	 *  Empty array clears. Idempotent per call. */
	setExtraCursors(cursors: readonly ExtraCursor[]): void;
	/** Stamp a `⋯` fold badge at the end of the given (view) lines
	 *  (9.7.3 folding). Empty array clears. Idempotent per call. */
	setFoldBadges(lines: readonly number[]): void;
	/** Paint inline diagnostic squiggles (9.7.6) — a wavy underline per
	 *  range, error vs warning by severity class. Empty array clears.
	 *  Idempotent per call. */
	setDiagnostics(ranges: readonly DiagnosticRange[]): void;
	/** Bounding rect (viewport coords) of the buffer position at `offset`,
	 *  measured by stamping a temporary zero-width probe in the offset's
	 *  line — reusing the same (line, column) geometry as the caret
	 *  decorations so the completion popup (9.7.3) anchors exactly under
	 *  the text caret. Returns null when that line isn't painted. */
	caretRect(offset: number): DOMRect | null;
	/** Mirror the textarea's vertical + horizontal scroll. */
	syncScroll(scrollTop: number, scrollLeft: number): void;
	/** Decorate the buffer's citation spans (SH-14) — the renderer wires
	 *  hover popovers off the rendered `data-citation` anchors. Idempotent
	 *  per call (replaces the previous decoration set). */
	setCitations(spans: readonly CitationSpan[]): void;
	/** Detach + remove the overlay element. Idempotent. */
	dispose(): void;
	/** The mounted overlay element — exposed so the caller can append it
	 *  in the right z-order under the textarea. */
	readonly element: HTMLPreElement;
}

/** Attribute name for the citation key on a `<span>`; the citation
 *  hover binds its popover to elements carrying this attr. Centralised
 *  so the overlay + hover layer agree by construction. */
export const CITATION_ATTR = "data-citation-key";
/** Offset (number) of the first character of the citation in the
 *  buffer. Used by the hover layer for telemetry / future jump-to. */
export const CITATION_OFFSET_ATTR = "data-citation-offset";

/** Class for a per-line container (`<div>`). Centralised so guide
 *  placement and line rendering agree on the selector. */
const LINE_CLASS = "editor__highlight-line";
/** Class for a single vertical indent-guide rule. */
const GUIDE_CLASS = "editor__indent-guide";
/** Class for a matched-bracket marker (`<span>`) drawn over a bracket
 *  character. Centralised so the placement code and CSS agree. */
const BRACKET_CLASS = "editor__bracket-match";
/** Class for a find-match marker; the active match adds the modifier. */
const FIND_MATCH_CLASS = "editor__find-match";
const FIND_MATCH_ACTIVE_CLASS = "editor__find-match--active";
/** Classes for the secondary multi-cursor paint. */
const EXTRA_CARET_CLASS = "editor__extra-caret";
const EXTRA_SELECTION_CLASS = "editor__extra-selection";
/** Class for the fold `⋯` badge appended to a folded header line. */
const FOLD_BADGE_CLASS = "editor__fold-badge";
/** Class for the zero-width caret probe used by {@link HighlightOverlayHandle.caretRect}. */
const CARET_PROBE_CLASS = "editor__caret-probe";
/** Class for an inline diagnostic squiggle; severity adds the modifier.
 *  (Distinct from `editor__diagnostic`, which is the problem-LIST row.) */
const DIAGNOSTIC_CLASS = "editor__squiggle";
const DIAGNOSTIC_ERROR_CLASS = "editor__squiggle--error";
const DIAGNOSTIC_WARNING_CLASS = "editor__squiggle--warning";

export function createHighlightOverlay(): HighlightOverlayHandle {
	const pre = document.createElement("pre");
	pre.className = "editor__highlight";
	pre.setAttribute("aria-hidden", "true");
	pre.dataset.empty = "true";

	let currentTokens: ThemedToken[][] | null = null;
	let currentFallback = "";
	let currentCitations: readonly CitationSpan[] = [];
	let currentGuides: readonly number[] = [];
	let currentBracket: BracketMatch | null = null;
	let currentFindMatches: readonly OffsetRange[] = [];
	let currentFindActive: OffsetRange | null = null;
	let currentExtraCursors: readonly ExtraCursor[] = [];
	let currentFoldBadges: readonly number[] = [];
	let currentDiagnostics: readonly DiagnosticRange[] = [];
	let disposed = false;

	function paint(): void {
		if (disposed) return;
		pre.replaceChildren();
		// Hard floor: when we have no tokens AND no fallback text the
		// overlay paints a single empty line so the gutter still aligns
		// against a non-zero height.
		if (!currentTokens && currentFallback.length === 0) {
			pre.appendChild(document.createElement("br"));
			pre.dataset.empty = "true";
			applyGuides();
			applyBracketMatch();
			return;
		}
		pre.dataset.empty = "false";
		if (!currentTokens) {
			renderPlain(pre, currentFallback, currentCitations);
		} else {
			renderTokens(pre, currentTokens, currentCitations);
		}
		applyGuides();
		applyBracketMatch();
		applyRangeDecorations();
		applyFoldBadges();
		applyDiagnostics();
	}

	/** Stamp a wavy-underline marker per diagnostic range, split per line —
	 *  the same absolutely-positioned-segment idiom as the find decorations,
	 *  with severity driving the underline colour. */
	function applyDiagnostics(): void {
		if (currentDiagnostics.length === 0) return;
		const lineStarts = buildLineOffsets(currentFallback);
		const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
		for (const d of currentDiagnostics) {
			const severityClass =
				d.severity === DiagnosticSeverity.Error ? DIAGNOSTIC_ERROR_CLASS : DIAGNOSTIC_WARNING_CLASS;
			for (const seg of rangeSegments(
				{ from: d.from, to: d.to },
				lineStarts,
				currentFallback.length,
			)) {
				const line = lines[seg.line];
				if (!line) continue;
				const marker = document.createElement("span");
				marker.className = `${DIAGNOSTIC_CLASS} ${severityClass}`;
				marker.style.left = `${seg.column}ch`;
				marker.style.width = `${Math.max(seg.length, 1)}ch`;
				line.appendChild(marker);
			}
		}
	}

	/** Paint the find matches + secondary multi-cursors as absolutely
	 *  positioned segments inside their `position: relative` line
	 *  elements — the bracket-marker idiom, generalised to multi-char /
	 *  multi-line ranges (a range is split into one segment per line). */
	function applyRangeDecorations(): void {
		const lineStarts = buildLineOffsets(currentFallback);
		const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
		const stamp = (range: OffsetRange, className: string): void => {
			for (const seg of rangeSegments(range, lineStarts, currentFallback.length)) {
				const line = lines[seg.line];
				if (!line) continue;
				const marker = document.createElement("span");
				marker.className = className;
				marker.style.left = `${seg.column}ch`;
				marker.style.width = `${Math.max(seg.length, 1)}ch`;
				line.appendChild(marker);
			}
		};
		for (const match of currentFindMatches) {
			const isActive =
				currentFindActive !== null &&
				match.from === currentFindActive.from &&
				match.to === currentFindActive.to;
			stamp(match, isActive ? `${FIND_MATCH_CLASS} ${FIND_MATCH_ACTIVE_CLASS}` : FIND_MATCH_CLASS);
		}
		for (const cursor of currentExtraCursors) {
			if (cursor.to > cursor.from) stamp(cursor, EXTRA_SELECTION_CLASS);
			const placement = locateOffset(cursor.caret, lineStarts);
			const line = placement ? lines[placement.line] : undefined;
			if (!placement || !line) continue;
			const caret = document.createElement("span");
			caret.className = EXTRA_CARET_CLASS;
			caret.style.left = `${placement.column}ch`;
			line.appendChild(caret);
		}
	}

	/** Append a `⋯` badge to each folded header line so the hidden span
	 *  has a visible anchor (the gutter chevron is the toggle). */
	function applyFoldBadges(): void {
		if (currentFoldBadges.length === 0) return;
		const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
		for (const lineIdx of currentFoldBadges) {
			const line = lines[lineIdx];
			if (!line) continue;
			const badge = document.createElement("span");
			badge.className = FOLD_BADGE_CLASS;
			badge.textContent = "⋯";
			line.appendChild(badge);
		}
	}

	/** Draw a marker over each bracket of the matched pair. Each marker is a
	 *  1-character-wide absolutely-positioned `<span>` inside its line `<div>`
	 *  (which is `position: relative`), placed at the bracket's column so it
	 *  scrolls / disposes with the line for free — the same idiom as the
	 *  indent guides. Offsets map to (line, column) via the buffer text the
	 *  overlay was last painted with. */
	function applyBracketMatch(): void {
		if (!currentBracket) return;
		const lineStarts = buildLineOffsets(currentFallback);
		const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
		for (const offset of [currentBracket.open, currentBracket.close]) {
			const placement = locateOffset(offset, lineStarts);
			if (!placement) continue;
			const line = lines[placement.line];
			if (!line) continue;
			const marker = document.createElement("span");
			marker.className = BRACKET_CLASS;
			marker.style.left = `${placement.column}ch`;
			line.appendChild(marker);
		}
	}

	/** Stamp the per-line indent guides onto the already-painted line
	 *  elements. Each guide is an absolutely-positioned 1px rule inside its
	 *  line `<div>` (which is `position: relative`); drawing guides as
	 *  children of the line — rather than a separate overlay — means they
	 *  scroll, wrap-collapse, and dispose with the line for free. */
	function applyGuides(): void {
		const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const depth = currentGuides[i] ?? 0;
			for (let level = 0; level < depth; level++) {
				const guide = document.createElement("span");
				guide.className = GUIDE_CLASS;
				guide.style.left = `${level * GUIDE_INDENT_COLUMNS}ch`;
				line.appendChild(guide);
			}
		}
	}

	return {
		element: pre,
		setTokens(tokens, fallbackText) {
			currentTokens = tokens;
			currentFallback = fallbackText;
			paint();
		},
		caretRect(offset) {
			const lineStarts = buildLineOffsets(currentFallback);
			// Clamp into the painted text — a stale offset past the buffer end
			// (e.g. an external edit shrank it) would otherwise place the probe
			// past the line and return wrong coordinates.
			const clamped = Math.min(Math.max(offset, 0), currentFallback.length);
			const placement = locateOffset(clamped, lineStarts);
			if (!placement) return null;
			const lines = pre.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`);
			const line = lines[placement.line];
			if (!line) return null;
			const probe = document.createElement("span");
			probe.className = CARET_PROBE_CLASS;
			probe.style.left = `${placement.column}ch`;
			line.appendChild(probe);
			const rect = probe.getBoundingClientRect();
			probe.remove();
			return rect;
		},
		syncScroll(scrollTop, scrollLeft) {
			pre.scrollTop = scrollTop;
			pre.scrollLeft = scrollLeft;
		},
		setCitations(spans) {
			currentCitations = spans;
			paint();
		},
		setIndentGuides(depths) {
			currentGuides = depths;
			paint();
		},
		setBracketMatch(match) {
			currentBracket = match;
			paint();
		},
		setFindMatches(matches, active) {
			currentFindMatches = matches;
			currentFindActive = active;
			paint();
		},
		setExtraCursors(cursors) {
			currentExtraCursors = cursors;
			paint();
		},
		setFoldBadges(lines) {
			currentFoldBadges = lines;
			paint();
		},
		setDiagnostics(ranges) {
			currentDiagnostics = ranges;
			paint();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			pre.remove();
		},
	};
}

/** Paint the buffer as unstyled spans, but still decorate citation
 *  ranges so the hover layer works even when no grammar is loaded
 *  (PlainText, load-failure, very long file before tokenize lands). */
function renderPlain(pre: HTMLPreElement, text: string, citations: readonly CitationSpan[]): void {
	const lineOffsets = buildLineOffsets(text);
	const lines = text.length === 0 ? [""] : text.split("\n");
	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = document.createElement("div");
		line.className = LINE_CLASS;
		const lineText = lines[lineIdx] ?? "";
		const lineStart = lineOffsets[lineIdx] ?? 0;
		const lineEnd = lineStart + lineText.length;
		appendDecoratedRange(line, lineText, lineStart, lineEnd, citations);
		pre.appendChild(line);
	}
}

/** Paint Shiki's 2-D ThemedToken[] grid. Each line is a `<div>` (block
 *  per line, matching the gutter); tokens inside are inline spans with
 *  the per-token foreground colour as an inline style. Citations may
 *  span multiple tokens, so we walk the absolute offsets and split a
 *  token when a citation boundary falls inside it. */
function renderTokens(
	pre: HTMLPreElement,
	lines: ThemedToken[][],
	citations: readonly CitationSpan[],
): void {
	let absoluteOffset = 0;
	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = document.createElement("div");
		line.className = LINE_CLASS;
		const tokens = lines[lineIdx] ?? [];
		if (tokens.length === 0) {
			// A truly empty line still needs a height — a zero-width
			// inline-block placeholder keeps the gutter aligned.
			line.appendChild(document.createElement("br"));
			pre.appendChild(line);
			absoluteOffset += 1; // for the newline that follows
			continue;
		}
		for (const token of tokens) {
			const tokenStart = absoluteOffset;
			const tokenEnd = tokenStart + token.content.length;
			appendDecoratedToken(line, token, tokenStart, tokenEnd, citations);
			absoluteOffset = tokenEnd;
		}
		pre.appendChild(line);
		absoluteOffset += 1; // newline between source lines
	}
}

/** Append a Shiki token to the line, splitting it at citation
 *  boundaries so a citation span renders as `<span data-citation-key>`
 *  while keeping the surrounding code's colour. */
function appendDecoratedToken(
	line: HTMLDivElement,
	token: ThemedToken,
	start: number,
	end: number,
	citations: readonly CitationSpan[],
): void {
	const segments = splitByCitations(start, end, citations);
	for (const seg of segments) {
		const span = document.createElement("span");
		span.className = "editor__highlight-token";
		if (token.color) span.style.color = token.color;
		span.textContent = token.content.slice(seg.start - start, seg.end - start);
		if (seg.citation) decorateCitation(span, seg.citation);
		line.appendChild(span);
	}
}

/** Append a plain (un-highlighted) range — used by {@link renderPlain}
 *  for unhighlighted languages. Citations still get a `<span>` so the
 *  hover layer works. */
function appendDecoratedRange(
	line: HTMLDivElement,
	text: string,
	start: number,
	end: number,
	citations: readonly CitationSpan[],
): void {
	const segments = splitByCitations(start, end, citations);
	for (const seg of segments) {
		const span = document.createElement("span");
		span.className = "editor__highlight-token";
		span.textContent = text.slice(seg.start - start, seg.end - start);
		if (seg.citation) decorateCitation(span, seg.citation);
		line.appendChild(span);
	}
}

function decorateCitation(el: HTMLElement, citation: CitationSpan): void {
	el.classList.add("editor__citation");
	el.setAttribute(CITATION_ATTR, citation.entry.key);
	el.setAttribute(CITATION_OFFSET_ATTR, String(citation.start));
}

interface Segment {
	start: number;
	end: number;
	citation: CitationSpan | null;
}

/**
 * Split a `[start, end)` range into segments at citation boundaries.
 * The returned segments cover the input range exactly with no gaps and
 * no overlaps; segments inside a citation reference it via
 * `seg.citation`, plain segments carry `null`. Pure — exported for
 * tests; the renderer never inspects intermediate segments.
 */
export function splitByCitations(
	start: number,
	end: number,
	citations: readonly CitationSpan[],
): Segment[] {
	if (end <= start) return [];
	const relevant = citations.filter((c) => c.end > start && c.start < end);
	if (relevant.length === 0) return [{ start, end, citation: null }];
	const out: Segment[] = [];
	let cursor = start;
	for (const cit of relevant) {
		const cStart = Math.max(cit.start, start);
		const cEnd = Math.min(cit.end, end);
		if (cStart > cursor) out.push({ start: cursor, end: cStart, citation: null });
		if (cEnd > cStart) out.push({ start: cStart, end: cEnd, citation: cit });
		cursor = cEnd;
	}
	if (cursor < end) out.push({ start: cursor, end, citation: null });
	return out;
}

/** Build a parallel array of absolute offsets for each line start.
 *  `lineOffsets[i]` is the buffer offset of the first character of
 *  line `i` (0-based). The last entry is the position after the final
 *  character — useful when callers walk to the end of the file. */
function buildLineOffsets(text: string): number[] {
	const offsets: number[] = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) offsets.push(i + 1);
	}
	return offsets;
}

interface RangeSegment {
	line: number;
	column: number;
	length: number;
}

/** Split an absolute offset range into one segment per line it spans
 *  (a marker is positioned inside its line element, so a multi-line
 *  range needs one marker per line). Pure — exported for tests. */
export function rangeSegments(
	range: OffsetRange,
	lineStarts: readonly number[],
	textLength: number,
): RangeSegment[] {
	const from = Math.max(0, Math.min(range.from, textLength));
	const to = Math.max(from, Math.min(range.to, textLength));
	const start = locateOffset(from, lineStarts);
	const end = locateOffset(to, lineStarts);
	if (!start || !end) return [];
	if (start.line === end.line) {
		return [{ line: start.line, column: start.column, length: end.column - start.column }];
	}
	const segments: RangeSegment[] = [];
	for (let line = start.line; line <= end.line; line++) {
		const lineStart = lineStarts[line] ?? 0;
		const lineEnd =
			line + 1 < lineStarts.length ? (lineStarts[line + 1] ?? textLength) - 1 : textLength;
		const segFrom = line === start.line ? from : lineStart;
		const segTo = line === end.line ? to : lineEnd;
		segments.push({ line, column: segFrom - lineStart, length: Math.max(0, segTo - segFrom) });
	}
	return segments;
}

/** Map an absolute buffer offset to its `{ line, column }` (both 0-based)
 *  given the line-start offsets from {@link buildLineOffsets}. Returns null
 *  when the offset is out of range. Exported for tests. */
export function locateOffset(
	offset: number,
	lineStarts: readonly number[],
): { line: number; column: number } | null {
	if (offset < 0) return null;
	for (let line = lineStarts.length - 1; line >= 0; line--) {
		const start = lineStarts[line] ?? 0;
		if (offset >= start) return { line, column: offset - start };
	}
	return null;
}
