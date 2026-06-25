/**
 * 9.7.3 — folding model: indent-region detection, fold-view text /
 * gutter mapping, and the view→doc caret mapping the unfold-on-edit
 * policy relies on.
 */
import { describe, expect, it } from "vitest";
import {
	activeFoldRegions,
	buildFoldView,
	foldableRegions,
	regionAtHeader,
	regionContaining,
	viewToDoc,
} from "./folding";

const SRC = ["function a() {", "  one;", "  two;", "}", "const x = 1;"].join("\n");

describe("foldableRegions", () => {
	it("finds an indent region under its header line", () => {
		expect(foldableRegions(SRC)).toEqual([{ header: 0, start: 1, end: 2 }]);
	});

	it("bridges blank lines inside a block but not after it", () => {
		const text = ["if (x) {", "  a;", "", "  b;", "}", "", "done"].join("\n");
		expect(foldableRegions(text)).toEqual([{ header: 0, start: 1, end: 3 }]);
	});

	it("nested blocks produce nested regions", () => {
		const text = ["a {", "  b {", "    c;", "  }", "}"].join("\n");
		const regions = foldableRegions(text);
		expect(regions).toContainEqual({ header: 0, start: 1, end: 3 });
		expect(regions).toContainEqual({ header: 1, start: 2, end: 2 });
	});

	it("tab indentation counts", () => {
		const text = "header:\n\tchild\n\tchild2\nnext";
		expect(foldableRegions(text)).toEqual([{ header: 0, start: 1, end: 2 }]);
	});

	it("flat text has no regions", () => {
		expect(foldableRegions("a\nb\nc")).toEqual([]);
	});
});

describe("region lookups", () => {
	const regions = foldableRegions(SRC);

	it("regionAtHeader finds the exact header", () => {
		expect(regionAtHeader(regions, 0)).toMatchObject({ header: 0 });
		expect(regionAtHeader(regions, 1)).toBeNull();
	});

	it("regionContaining picks the innermost region around a body line", () => {
		const nested = foldableRegions(["a {", "  b {", "    c;", "  }", "}"].join("\n"));
		expect(regionContaining(nested, 2)).toMatchObject({ header: 1 });
		expect(regionContaining(nested, 1)).toMatchObject({ header: 1 });
		expect(regionContaining(nested, 3)).toMatchObject({ header: 0 });
		// The closing line at header indent sits OUTSIDE the indent region.
		expect(regionContaining(nested, 4)).toBeNull();
	});
});

describe("buildFoldView", () => {
	it("removes the folded body lines and maps gutter numbers", () => {
		const regions = foldableRegions(SRC);
		const view = buildFoldView(SRC, regions);
		expect(view.text).toBe(["function a() {", "}", "const x = 1;"].join("\n"));
		expect(view.docLines).toEqual([0, 3, 4]);
		expect(view.foldedViewLines).toEqual([0]);
	});

	it("stale fold headers resolve to no active regions", () => {
		const regions = foldableRegions(SRC);
		expect(activeFoldRegions(regions, new Set([99]))).toEqual([]);
		expect(activeFoldRegions(regions, new Set([0]))).toHaveLength(1);
	});
});

describe("viewToDoc", () => {
	it("maps a view caret to the same line/column in doc space", () => {
		const view = buildFoldView(SRC, foldableRegions(SRC));
		// View line 1 is "}" — doc line 3. Caret at its start.
		const closingBraceView = view.text.indexOf("}");
		const docOffset = viewToDoc(view, SRC, closingBraceView);
		expect(SRC.slice(docOffset, docOffset + 1)).toBe("}");
		// View line 2 column 6 → "x" of `const x`.
		const constLineView = view.text.indexOf("const") + 6;
		expect(SRC.slice(viewToDoc(view, SRC, constLineView))).toMatch(/^x = 1;/);
	});

	it("clamps out-of-range offsets", () => {
		const view = buildFoldView(SRC, foldableRegions(SRC));
		expect(viewToDoc(view, SRC, 10_000)).toBeLessThanOrEqual(SRC.length);
		expect(viewToDoc(view, SRC, -5)).toBe(0);
	});
});
