/**
 * @vitest-environment jsdom
 *
 * Highlight overlay — token rendering + citation decoration.
 *
 * The render-paths consume Shiki's `ThemedToken[][]` (or null for plain
 * paint) plus a citation span list, and emit `<div class="…__line">`
 * children with per-token `<span>` colours and `data-citation-key`
 * decoration. We exercise both paths and the citation-split logic with
 * synthetic spans.
 */

import type { ThemedToken } from "shiki/core";
import { describe, expect, it } from "vitest";
import type { CitationEntry, CitationKind } from "../logic/citation-index";
import type { CitationSpan } from "../logic/citation-scan";
import { DiagnosticSeverity } from "../logic/diagnostics";
import {
	CITATION_ATTR,
	CITATION_OFFSET_ATTR,
	GUIDE_INDENT_COLUMNS,
	createHighlightOverlay,
	locateOffset,
	rangeSegments,
	splitByCitations,
} from "./highlight-overlay";

function token(content: string, color: string, offset = 0): ThemedToken {
	return { content, color, offset } as ThemedToken;
}

function entry(code: string): CitationEntry {
	return {
		kind: "iteration" as CitationKind,
		key: code.toUpperCase(),
		code,
		entityId: `e-${code}`,
		entityType: "brainstorm/Iteration/v1",
		title: code,
		status: "done",
		summary: "",
	};
}

function span(start: number, end: number, code: string): CitationSpan {
	return { start, end, code, entry: entry(code) };
}

describe("splitByCitations", () => {
	it("returns one plain segment when no citations overlap", () => {
		expect(splitByCitations(0, 5, [])).toEqual([{ start: 0, end: 5, citation: null }]);
		expect(splitByCitations(0, 5, [span(10, 15, "x")])).toEqual([
			{ start: 0, end: 5, citation: null },
		]);
	});

	it("emits an empty list for an empty range", () => {
		expect(splitByCitations(5, 5, [])).toEqual([]);
		expect(splitByCitations(5, 4, [])).toEqual([]);
	});

	it("splits a token at a single citation boundary", () => {
		const cit = span(3, 6, "x");
		const out = splitByCitations(0, 10, [cit]);
		expect(out).toEqual([
			{ start: 0, end: 3, citation: null },
			{ start: 3, end: 6, citation: cit },
			{ start: 6, end: 10, citation: null },
		]);
	});

	it("clamps a citation that extends beyond the token range", () => {
		const cit = span(0, 100, "x");
		const out = splitByCitations(5, 10, [cit]);
		expect(out).toEqual([{ start: 5, end: 10, citation: cit }]);
	});

	it("emits multiple disjoint citations in order", () => {
		const a = span(1, 3, "a");
		const b = span(5, 7, "b");
		const out = splitByCitations(0, 10, [a, b]);
		expect(out.map((s) => `${s.start}-${s.end}:${s.citation?.code ?? "_"}`)).toEqual([
			"0-1:_",
			"1-3:a",
			"3-5:_",
			"5-7:b",
			"7-10:_",
		]);
	});
});

describe("locateOffset", () => {
	// Line starts for "ab\ncd\ne" → [0, 3, 6].
	const starts = [0, 3, 6];

	it("maps a same-line offset to (line, column)", () => {
		expect(locateOffset(0, starts)).toEqual({ line: 0, column: 0 });
		expect(locateOffset(1, starts)).toEqual({ line: 0, column: 1 });
	});

	it("maps an offset at a line start to column 0", () => {
		expect(locateOffset(3, starts)).toEqual({ line: 1, column: 0 });
		expect(locateOffset(6, starts)).toEqual({ line: 2, column: 0 });
	});

	it("maps a mid-line offset on a later line", () => {
		expect(locateOffset(4, starts)).toEqual({ line: 1, column: 1 });
	});

	it("returns null for a negative offset", () => {
		expect(locateOffset(-1, starts)).toBeNull();
	});
});

describe("createHighlightOverlay", () => {
	it("paints unstyled lines when given no tokens (plain fallback)", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "hello\nworld");
		expect(overlay.element.dataset.empty).toBe("false");
		const lines = overlay.element.querySelectorAll(".editor__highlight-line");
		expect(lines).toHaveLength(2);
		expect(lines[0]?.textContent).toBe("hello");
		expect(lines[1]?.textContent).toBe("world");
	});

	it("paints an empty placeholder for an empty buffer", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "");
		expect(overlay.element.dataset.empty).toBe("true");
	});

	it("paints tokens with their Shiki colour", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens([[token("const", "#ff0000")]], "const");
		const tokenEl = overlay.element.querySelector<HTMLElement>(".editor__highlight-token");
		expect(tokenEl?.textContent).toBe("const");
		expect(tokenEl?.style.color).toBe("rgb(255, 0, 0)");
	});

	it("preserves blank lines between tokens", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens([[token("a", "#000")], [], [token("b", "#000")]], "a\n\nb");
		const lines = overlay.element.querySelectorAll(".editor__highlight-line");
		expect(lines).toHaveLength(3);
		// The empty line carries a <br> rather than text content.
		expect(lines[1]?.querySelector("br")).toBeTruthy();
	});

	it("decorates citation spans with data attributes (token mode)", () => {
		const overlay = createHighlightOverlay();
		const cit = span(2, 5, "OQ-1");
		overlay.setTokens([[token("abcdef", "#000")]], "abcdef");
		overlay.setCitations([cit]);
		const decorated = overlay.element.querySelectorAll<HTMLElement>(`[${CITATION_ATTR}]`);
		expect(decorated).toHaveLength(1);
		expect(decorated[0]?.textContent).toBe("cde");
		expect(decorated[0]?.getAttribute(CITATION_ATTR)).toBe("OQ-1");
		expect(decorated[0]?.getAttribute(CITATION_OFFSET_ATTR)).toBe("2");
	});

	it("decorates citation spans in plain-fallback mode too", () => {
		const overlay = createHighlightOverlay();
		const cit = span(0, 4, "9.7.2");
		overlay.setTokens(null, "9.7.2 is the iteration");
		overlay.setCitations([cit]);
		const decorated = overlay.element.querySelectorAll<HTMLElement>(`[${CITATION_ATTR}]`);
		expect(decorated.length).toBeGreaterThanOrEqual(1);
		expect(decorated[0]?.getAttribute(CITATION_ATTR)).toBe("9.7.2");
	});

	it("draws one indent-guide rule per depth on each line", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "a\n  b\n    c");
		overlay.setIndentGuides([0, 1, 2]);
		const lines = overlay.element.querySelectorAll(".editor__highlight-line");
		expect(lines[0]?.querySelectorAll(".editor__indent-guide")).toHaveLength(0);
		expect(lines[1]?.querySelectorAll(".editor__indent-guide")).toHaveLength(1);
		expect(lines[2]?.querySelectorAll(".editor__indent-guide")).toHaveLength(2);
	});

	it("positions each guide at its indent column", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "a\n    b");
		overlay.setIndentGuides([0, 2]);
		const guides = overlay.element
			.querySelectorAll<HTMLElement>(".editor__highlight-line")[1]
			?.querySelectorAll<HTMLElement>(".editor__indent-guide");
		expect(guides?.[0]?.style.left).toBe(`${0 * GUIDE_INDENT_COLUMNS}ch`);
		expect(guides?.[1]?.style.left).toBe(`${1 * GUIDE_INDENT_COLUMNS}ch`);
	});

	it("re-rendering tokens preserves the indent guides", () => {
		const overlay = createHighlightOverlay();
		overlay.setIndentGuides([0, 1]);
		overlay.setTokens(null, "a\n  b");
		expect(overlay.element.querySelectorAll(".editor__indent-guide")).toHaveLength(1);
		// A fresh token paint must not orphan the guides.
		overlay.setTokens([[token("a", "#000")], [token("  b", "#000")]], "a\n  b");
		expect(overlay.element.querySelectorAll(".editor__indent-guide")).toHaveLength(1);
	});

	it("clears guides when given an empty depth list", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "  a");
		overlay.setIndentGuides([1]);
		expect(overlay.element.querySelectorAll(".editor__indent-guide")).toHaveLength(1);
		overlay.setIndentGuides([]);
		expect(overlay.element.querySelectorAll(".editor__indent-guide")).toHaveLength(0);
	});

	it("ignores depths beyond the rendered line count", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "a");
		overlay.setIndentGuides([0, 2, 3]);
		expect(overlay.element.querySelectorAll(".editor__indent-guide")).toHaveLength(0);
	});

	it("draws a marker over each bracket of the matched pair", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "a(b)c");
		overlay.setBracketMatch({ open: 1, close: 3 });
		const markers = overlay.element.querySelectorAll<HTMLElement>(".editor__bracket-match");
		expect(markers).toHaveLength(2);
		// Both brackets are on line 0; columns are the bracket offsets.
		expect(markers[0]?.style.left).toBe("1ch");
		expect(markers[1]?.style.left).toBe("3ch");
	});

	it("places bracket markers on the correct lines + columns across lines", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "fn(\n  x\n)");
		// "(" is offset 2 on line 0; ")" is offset 8 (line 2, column 0).
		overlay.setBracketMatch({ open: 2, close: 8 });
		const lines = overlay.element.querySelectorAll<HTMLElement>(".editor__highlight-line");
		expect(lines[0]?.querySelectorAll(".editor__bracket-match")).toHaveLength(1);
		expect(lines[1]?.querySelectorAll(".editor__bracket-match")).toHaveLength(0);
		const closing = lines[2]?.querySelector<HTMLElement>(".editor__bracket-match");
		expect(closing?.style.left).toBe("0ch");
	});

	it("clears the bracket markers when given null", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "(x)");
		overlay.setBracketMatch({ open: 0, close: 2 });
		expect(overlay.element.querySelectorAll(".editor__bracket-match")).toHaveLength(2);
		overlay.setBracketMatch(null);
		expect(overlay.element.querySelectorAll(".editor__bracket-match")).toHaveLength(0);
	});

	it("preserves the bracket markers across a token re-paint", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "(x)");
		overlay.setBracketMatch({ open: 0, close: 2 });
		expect(overlay.element.querySelectorAll(".editor__bracket-match")).toHaveLength(2);
		overlay.setTokens([[token("(x)", "#000")]], "(x)");
		expect(overlay.element.querySelectorAll(".editor__bracket-match")).toHaveLength(2);
	});

	it("syncScroll mirrors the textarea's scroll", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "x");
		document.body.appendChild(overlay.element);
		overlay.syncScroll(42, 7);
		expect(overlay.element.scrollTop).toBe(42);
		expect(overlay.element.scrollLeft).toBe(7);
		overlay.dispose();
	});

	it("dispose() removes the element idempotently", () => {
		const overlay = createHighlightOverlay();
		document.body.appendChild(overlay.element);
		overlay.dispose();
		overlay.dispose(); // second call is a no-op
		expect(overlay.element.isConnected).toBe(false);
	});
});

describe("rangeSegments", () => {
	const text = "alpha\nbe\ngamma";
	const starts = [0, 6, 9];

	it("a single-line range is one segment", () => {
		expect(rangeSegments({ from: 1, to: 4 }, starts, text.length)).toEqual([
			{ line: 0, column: 1, length: 3 },
		]);
	});

	it("a multi-line range splits at line boundaries", () => {
		expect(rangeSegments({ from: 3, to: 11 }, starts, text.length)).toEqual([
			{ line: 0, column: 3, length: 2 },
			{ line: 1, column: 0, length: 2 },
			{ line: 2, column: 0, length: 2 },
		]);
	});

	it("clamps out-of-range offsets", () => {
		expect(rangeSegments({ from: -2, to: 100 }, starts, text.length)).toHaveLength(3);
	});
});

describe("overlay range decorations", () => {
	it("paints find matches with the active modifier on the active one", () => {
		const overlay = createHighlightOverlay();
		document.body.appendChild(overlay.element);
		overlay.setTokens(null, "foo bar foo");
		overlay.setFindMatches(
			[
				{ from: 0, to: 3 },
				{ from: 8, to: 11 },
			],
			{ from: 8, to: 11 },
		);
		const marks = overlay.element.querySelectorAll(".editor__find-match");
		expect(marks).toHaveLength(2);
		const active = overlay.element.querySelectorAll(".editor__find-match--active");
		expect(active).toHaveLength(1);
		expect((active[0] as HTMLElement).style.left).toBe("8ch");
		overlay.setFindMatches([], null);
		expect(overlay.element.querySelectorAll(".editor__find-match")).toHaveLength(0);
		overlay.dispose();
	});

	it("paints extra cursors as caret rules plus selection washes", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "one\ntwo");
		overlay.setExtraCursors([
			{ from: 5, to: 5, caret: 5 },
			{ from: 0, to: 3, caret: 3 },
		]);
		expect(overlay.element.querySelectorAll(".editor__extra-caret")).toHaveLength(2);
		expect(overlay.element.querySelectorAll(".editor__extra-selection")).toHaveLength(1);
		overlay.setExtraCursors([]);
		expect(overlay.element.querySelectorAll(".editor__extra-caret")).toHaveLength(0);
		overlay.dispose();
	});

	it("stamps fold badges on the requested lines", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "head\ntail");
		overlay.setFoldBadges([0]);
		const badges = overlay.element.querySelectorAll(".editor__fold-badge");
		expect(badges).toHaveLength(1);
		expect(badges[0]?.closest(".editor__highlight-line")).toBe(
			overlay.element.querySelector(".editor__highlight-line"),
		);
		overlay.dispose();
	});

	it("paints a diagnostic squiggle with the severity class at the span", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "const x = 1;  ");
		overlay.setDiagnostics([{ from: 12, to: 14, severity: DiagnosticSeverity.Warning }]);
		const marker = overlay.element.querySelector<HTMLElement>(".editor__squiggle");
		expect(marker?.classList.contains("editor__squiggle--warning")).toBe(true);
		expect(marker?.style.left).toBe("12ch");
		expect(marker?.style.width).toBe("2ch");
		overlay.dispose();
	});

	it("splits a multi-line diagnostic into one marker per line + clears", () => {
		const overlay = createHighlightOverlay();
		overlay.setTokens(null, "fn(\n  x");
		overlay.setDiagnostics([{ from: 2, to: 7, severity: DiagnosticSeverity.Error }]);
		const lines = overlay.element.querySelectorAll<HTMLElement>(".editor__highlight-line");
		expect(lines[0]?.querySelectorAll(".editor__squiggle--error")).toHaveLength(1);
		expect(lines[1]?.querySelectorAll(".editor__squiggle--error")).toHaveLength(1);
		overlay.setDiagnostics([]);
		expect(overlay.element.querySelectorAll(".editor__squiggle")).toHaveLength(0);
		overlay.dispose();
	});
});
