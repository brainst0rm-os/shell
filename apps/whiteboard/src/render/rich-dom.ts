/**
 * Rich-run ↔ DOM bridge (9.17.12 rest).
 *
 * Two directions:
 *   - `appendRunsTo` builds the styled span tree for a node body — used by
 *     both the static renderer (`node-dom`) and the contentEditable editor
 *     seed. Styled runs are `<span class="whiteboard__rich-run">` carrying
 *     `data-*` style attributes (the read-back source of truth) plus inline
 *     style from the centralized palettes in `types/node`; unstyled runs
 *     are bare text nodes.
 *   - `readRunsFromDom` walks an edited body back into runs. Typed text
 *     lands inside our spans (Chromium splits a span on Enter but copies
 *     its attributes) or as bare text nodes; `<br>` and block-element
 *     boundaries read as `\n` (the body CSS is `white-space: pre-wrap`).
 *     Pasted markup contributes its text with whatever `data-*`-styled
 *     ancestor it sits under — unknown tags don't crash, they flatten.
 *
 * Offsets: `domRangeOffsets` / `selectOffsets` map the live selection to
 * `[start, end)` plain-text offsets and back, so a formatting command can
 * rebuild the span tree without losing the selection.
 */

import { normalizeRuns } from "../logic/rich-text";
import {
	type TextColor,
	type TextSize,
	coerceTextColor,
	coerceTextSize,
	textColorToCss,
	textSizeToCss,
} from "../types/node";
import { type RichRun, isPlainRun } from "../types/rich-text";

export const RICH_RUN_CLASS = "whiteboard__rich-run";

/** Build one styled-run span. Exported for the renderer tests. */
export function buildRunSpan(doc: Document, run: RichRun): HTMLSpanElement {
	const span = doc.createElement("span");
	span.className = RICH_RUN_CLASS;
	if (run.bold) {
		span.dataset.bold = "1";
		span.style.fontWeight = "600";
	}
	if (run.italic) {
		span.dataset.italic = "1";
		span.style.fontStyle = "italic";
	}
	const deco: string[] = [];
	if (run.underline) {
		span.dataset.underline = "1";
		deco.push("underline");
	}
	if (run.strike) {
		span.dataset.strike = "1";
		deco.push("line-through");
	}
	if (deco.length > 0) span.style.textDecorationLine = deco.join(" ");
	if (run.color) {
		span.dataset.color = run.color;
		const css = textColorToCss(run.color);
		if (css) span.style.color = css;
	}
	if (run.size) {
		span.dataset.size = run.size;
		span.style.fontSize = textSizeToCss(run.size);
	}
	span.textContent = run.text;
	return span;
}

/** Replace `body`'s children with the run tree. */
export function appendRunsTo(body: HTMLElement, runs: readonly RichRun[]): void {
	const doc = body.ownerDocument;
	const children: Node[] = [];
	for (const run of runs) {
		if (isPlainRun(run)) children.push(doc.createTextNode(run.text));
		else children.push(buildRunSpan(doc, run));
	}
	body.replaceChildren(...children);
}

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "BLOCKQUOTE"]);

type WalkSink = {
	text(content: string, styled: Element | null, node: Node): void;
	/** `source` is the `<br>` or the block element whose boundary breaks. */
	newline(source: Node): void;
};

/** Shared DOM walk for read-back, so the `\n` contribution of `<br>` and
 *  block boundaries is defined in one place: a block element separates from
 *  any preceding content with one newline (the Chromium contentEditable
 *  line model — `first<div>second</div>` is two lines). */
function walkBody(body: HTMLElement, sink: WalkSink): void {
	let hasContent = false;
	const visit = (node: Node, styled: Element | null): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			const content = node.textContent ?? "";
			if (content !== "") {
				sink.text(content, styled, node);
				hasContent = true;
			}
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as Element;
		if (el.tagName === "BR") {
			sink.newline(el);
			hasContent = true;
			return;
		}
		if (BLOCK_TAGS.has(el.tagName) && hasContent) sink.newline(el);
		const nextStyled = elementCarriesStyle(el) ? el : styled;
		for (const child of Array.from(el.childNodes)) visit(child, nextStyled);
	};
	for (const child of Array.from(body.childNodes)) visit(child, null);
}

function elementCarriesStyle(el: Element): boolean {
	const d = (el as HTMLElement).dataset;
	if (!d) return false;
	return (
		d.bold === "1" ||
		d.italic === "1" ||
		d.underline === "1" ||
		d.strike === "1" ||
		d.color !== undefined ||
		d.size !== undefined
	);
}

function runFromStyled(text: string, styled: Element | null): RichRun {
	const run: RichRun = { text };
	if (!styled) return run;
	const d = (styled as HTMLElement).dataset;
	if (d.bold === "1") run.bold = true;
	if (d.italic === "1") run.italic = true;
	if (d.underline === "1") run.underline = true;
	if (d.strike === "1") run.strike = true;
	const color: TextColor | null = coerceTextColor(d.color);
	if (color) run.color = color;
	const size: TextSize | null = coerceTextSize(d.size);
	if (size) run.size = size;
	return run;
}

/** Read the edited body back into normalized runs. */
export function readRunsFromDom(body: HTMLElement): RichRun[] {
	const out: RichRun[] = [];
	walkBody(body, {
		text: (content, styled) => out.push(runFromStyled(content, styled)),
		newline: () => out.push({ text: "\n" }),
	});
	return normalizeRuns(out);
}

type Segment = { node: Node; len: number; isText: boolean };

/** The body's linear plain-text segments, in document order, using the same
 *  walk as `readRunsFromDom` — so selection offsets and run offsets agree
 *  even when the browser has introduced `<br>`/`<div>` line breaks. */
function buildSegments(body: HTMLElement): Segment[] {
	const segments: Segment[] = [];
	walkBody(body, {
		text: (content, _styled, node) => segments.push({ node, len: content.length, isText: true }),
		newline: (source) => segments.push({ node: source, len: 1, isText: false }),
	});
	return segments;
}

const BEFORE_BOUNDARY = Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS;

/** Plain-text offset of a `(container, offset)` DOM position inside `body`,
 *  or `null` when the position is outside the body. */
function offsetOfPosition(body: HTMLElement, container: Node, offset: number): number | null {
	if (container !== body && !body.contains(container)) return null;
	const segments = buildSegments(body);
	if (container.nodeType === Node.TEXT_NODE) {
		let pos = 0;
		for (const s of segments) {
			if (s.node === container) return pos + Math.min(offset, s.len);
			pos += s.len;
		}
		// An empty text node contributes no segment — resolve to the end.
		return pos;
	}
	// Element-anchored positions (e.g. triple-click) mean "before child
	// [offset]": count every segment strictly before that boundary. A block
	// segment whose element CONTAINS the boundary counts too — its break
	// sits before the element's content.
	const boundary = container.childNodes[offset] ?? null;
	let pos = 0;
	for (const s of segments) {
		let counts: boolean;
		if (boundary) {
			counts =
				s.node !== boundary && (boundary.compareDocumentPosition(s.node) & BEFORE_BOUNDARY) !== 0;
		} else if (container === body) {
			counts = true;
		} else {
			counts =
				container.contains(s.node) ||
				(container.compareDocumentPosition(s.node) & BEFORE_BOUNDARY) !== 0;
		}
		if (counts) pos += s.len;
	}
	return pos;
}

/** The current selection as `[start, end)` offsets, or `null` when the
 *  selection isn't inside `body`. */
export function domRangeOffsets(body: HTMLElement): { start: number; end: number } | null {
	const sel = body.ownerDocument.defaultView?.getSelection() ?? null;
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const start = offsetOfPosition(body, range.startContainer, range.startOffset);
	const end = offsetOfPosition(body, range.endContainer, range.endOffset);
	if (start === null || end === null) return null;
	return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** Resolve a plain-text offset back to a `(node, offset)` position. */
function positionAtOffset(body: HTMLElement, target: number): { node: Node; offset: number } {
	let pos = 0;
	let last: { node: Node; offset: number } = { node: body, offset: 0 };
	let found: { node: Node; offset: number } | null = null;
	const visit = (node: Node): void => {
		if (found) return;
		if (node.nodeType === Node.TEXT_NODE) {
			const len = (node.textContent ?? "").length;
			if (pos + len >= target) {
				found = { node, offset: target - pos };
				return;
			}
			pos += len;
			last = { node, offset: len };
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as Element;
		if (el.tagName === "BR") {
			pos += 1;
			return;
		}
		for (const child of Array.from(el.childNodes)) {
			visit(child);
			if (found) return;
		}
	};
	for (const child of Array.from(body.childNodes)) {
		visit(child);
		if (found) break;
	}
	return found ?? last;
}

/** Restore a `[start, end)` offset selection inside `body`. Guarded — a
 *  selection API gap must never abort the formatting command itself. */
export function selectOffsets(body: HTMLElement, start: number, end: number): void {
	try {
		const doc = body.ownerDocument;
		const from = positionAtOffset(body, start);
		const to = positionAtOffset(body, end);
		const range = doc.createRange();
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, to.offset);
		const sel = doc.defaultView?.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	} catch {
		// Selection restore is a nicety; the runs are already applied.
	}
}
