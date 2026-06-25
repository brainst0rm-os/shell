/**
 * `createDomTextSearchProvider` — the DOM-twin `TextSearchProvider`
 * (B9.3) for a **read-only rendered text surface**: Journal's day-body,
 * and any future projected-body app (captured Bookmarks, Preview text).
 *
 * The model here *is* the rendered DOM (these apps render an entity body
 * they don't edit in place — editing routes to Notes), so unlike the
 * Lexical adapter this addresses matches by a flat character offset into
 * the root's text content and re-derives them from the live DOM each
 * `search` (the surface is stable between searches). `revealMatch` wraps
 * the hit in a transient `<mark data-bs-find>` and scrolls it into view;
 * `clear()` restores the DOM exactly (unwrap + normalize). It is
 * deliberately **find-only**: `replaceMatch`/`replaceAll` are no-ops and
 * `selectionRange` is always `null` — a read surface is immutable and
 * has no "in selection" scope (the FindBar is mounted `mode:"find"`).
 *
 * Same seam as every other provider (doc 59): the controller treats the
 * `{start,end}` handle as opaque.
 */

import { FIND_SEED_MAX_LEN } from "./find-controller";
import type { FindQuery, ModelRange, TextSearchProvider } from "./find-controller";

export type DomMatch = { start: number; end: number };

export interface DomTextSearchProvider extends TextSearchProvider {
	/** Remove the transient highlight and restore the DOM. The host calls
	 *  this when the bar closes (the controller seam has no `clear`). */
	clear(): void;
}

const HIT_ATTR = "data-bs-find";

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `scrollIntoView` is a non-essential visual side effect and throws
 *  "Not implemented" under jsdom — never let it break reveal. */
function safeScrollIntoView(el: Element | null | undefined): void {
	try {
		el?.scrollIntoView?.({ block: "center" });
	} catch {
		/* headless / unsupported — reveal correctness is the wrap/selection */
	}
}

/** Literal matcher (regex itself is OQ-FR-1/v2 — the flag is honoured as
 *  literal here, exactly as the controller contract permits). */
function buildMatcher(query: FindQuery): RegExp | null {
	const { term, options } = query;
	if (term.length === 0) return null;
	let src = escapeRegExp(term);
	if (options.wholeWord) src = `\\b${src}\\b`;
	return new RegExp(src, options.caseSensitive ? "g" : "gi");
}

type Segment = { node: Text; start: number };

/** Ordered text segments under `root` (skipping our own `<mark>` is
 *  unnecessary — `clear()` always precedes a fresh walk). */
function collect(root: HTMLElement): { text: string; segments: Segment[] } {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const segments: Segment[] = [];
	let text = "";
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const t = n as Text;
		segments.push({ node: t, start: text.length });
		text += t.data;
	}
	return { text, segments };
}

/** Map a flat offset to a `{node, offset}` DOM position. `start`
 *  affinity binds to the node the character *begins* in; `end` affinity
 *  binds to the node the preceding character *ends* in — so a match that
 *  exactly fills one text node stays single-node (boundary offsets are
 *  otherwise ambiguous and would split it across the next node). */
function locate(
	segments: Segment[],
	offset: number,
	kind: "start" | "end",
): { node: Text; offset: number } | null {
	for (const seg of segments) {
		const len = seg.node.length;
		const within =
			kind === "start"
				? offset >= seg.start && offset < seg.start + len
				: offset > seg.start && offset <= seg.start + len;
		if (within) return { node: seg.node, offset: offset - seg.start };
	}
	const last = segments[segments.length - 1];
	if (last && offset >= last.start + last.node.length) {
		return { node: last.node, offset: last.node.length };
	}
	const first = segments[0];
	return first ? { node: first.node, offset: 0 } : null;
}

export function createDomTextSearchProvider(
	getRoot: () => HTMLElement | null | undefined,
): DomTextSearchProvider {
	let highlighted: HTMLElement | null = null;

	const clear = (): void => {
		const mark = highlighted;
		highlighted = null;
		if (!mark || !mark.parentNode) return;
		const parent = mark.parentNode;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		(parent as Element & { normalize(): void }).normalize?.();
	};

	return {
		get selectionRange(): ModelRange | null {
			return null;
		},

		// OQ-FR-4 — seed the find term from the live selection when it's a
		// non-empty, single-line (single-block heuristic), bounded run inside
		// the search root. A multi-line / oversized / out-of-root selection
		// returns null so the bar opens with the previous term.
		seedTerm(): string | null {
			const root = getRoot();
			const sel = root?.ownerDocument.defaultView?.getSelection?.();
			if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
			const range = sel.getRangeAt(0);
			if (!root.contains(range.commonAncestorContainer)) return null;
			const text = sel.toString();
			if (text.length === 0 || text.length > FIND_SEED_MAX_LEN || /[\n\r]/.test(text)) return null;
			return text;
		},

		search(query: FindQuery): DomMatch[] {
			const root = getRoot();
			const re = root ? buildMatcher(query) : null;
			if (!root || !re) return [];
			const { text } = collect(root);
			const matches: DomMatch[] = [];
			for (let m = re.exec(text); m; m = re.exec(text)) {
				matches.push({ start: m.index, end: m.index + m[0].length });
				if (m[0].length === 0) re.lastIndex++; // guard zero-width
			}
			return matches;
		},

		revealMatch(match: unknown): void {
			const { start, end } = match as DomMatch;
			const root = getRoot();
			if (!root) return;
			clear();
			const { segments } = collect(root);
			const a = locate(segments, start, "start");
			const b = locate(segments, end, "end");
			if (!a || !b) return;
			const range = root.ownerDocument.createRange();
			range.setStart(a.node, Math.min(a.offset, a.node.length));
			range.setEnd(b.node, Math.min(b.offset, b.node.length));
			if (a.node === b.node) {
				const mark = root.ownerDocument.createElement("mark");
				mark.className = "bs-find-hit";
				mark.setAttribute(HIT_ATTR, "");
				try {
					range.surroundContents(mark);
					highlighted = mark;
					safeScrollIntoView(mark);
					return;
				} catch {
					// fall through to selection-only reveal
				}
			}
			// Multi-node (rare) or un-surroundable: select + scroll, no wrap.
			const sel = root.ownerDocument.defaultView?.getSelection?.();
			if (sel) {
				sel.removeAllRanges();
				sel.addRange(range);
			}
			safeScrollIntoView(a.node.parentElement);
		},

		// Read-only surface: edits route to the owning editor (Notes).
		replaceMatch(): void {},
		replaceAll(): number {
			return 0;
		},

		clear,
	};
}
