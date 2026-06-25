/**
 * @vitest-environment jsdom
 *
 * Rich-run ↔ DOM bridge (9.17.12 rest): span building carries the data-*
 * style source of truth + inline presentation, the read-back walk inverts
 * it (including `<br>` / block boundaries as `\n`), and selection-offset
 * mapping round-trips through a rebuild.
 */

import { describe, expect, it } from "vitest";
import { TextColor, TextSize, textColorToCss, textSizeToCss } from "../types/node";
import type { RichRun } from "../types/rich-text";
import {
	appendRunsTo,
	buildRunSpan,
	domRangeOffsets,
	readRunsFromDom,
	selectOffsets,
} from "./rich-dom";

function mountBody(): HTMLElement {
	const body = document.createElement("div");
	document.body.appendChild(body);
	return body;
}

describe("buildRunSpan / appendRunsTo", () => {
	it("stamps data attributes + inline style for every mark", () => {
		const span = buildRunSpan(document, {
			text: "x",
			bold: true,
			italic: true,
			underline: true,
			strike: true,
			color: TextColor.Blue,
			size: TextSize.Large,
		});
		expect(span.dataset.bold).toBe("1");
		expect(span.dataset.italic).toBe("1");
		expect(span.dataset.underline).toBe("1");
		expect(span.dataset.strike).toBe("1");
		expect(span.dataset.color).toBe(TextColor.Blue);
		expect(span.dataset.size).toBe(TextSize.Large);
		expect(span.style.fontWeight).toBe("600");
		expect(span.style.fontStyle).toBe("italic");
		expect(span.style.textDecorationLine).toBe("underline line-through");
		expect(span.style.color).toBeTruthy();
		expect(span.style.fontSize).toBe(textSizeToCss(TextSize.Large));
		expect(textColorToCss(TextColor.Blue)).toBeTruthy();
	});

	it("renders unstyled runs as bare text nodes", () => {
		const body = mountBody();
		appendRunsTo(body, [{ text: "plain " }, { text: "bold", bold: true }]);
		expect(body.childNodes).toHaveLength(2);
		expect(body.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
		expect((body.childNodes[1] as HTMLElement).tagName).toBe("SPAN");
		expect(body.textContent).toBe("plain bold");
	});
});

describe("readRunsFromDom", () => {
	it("round-trips the styled run model", () => {
		const body = mountBody();
		const runs: RichRun[] = [
			{ text: "Hello " },
			{ text: "wor", bold: true, color: TextColor.Red },
			{ text: "ld", italic: true, size: TextSize.Small },
		];
		appendRunsTo(body, runs);
		expect(readRunsFromDom(body)).toEqual(runs);
	});

	it("reads <br> and block-element boundaries as newlines", () => {
		const body = mountBody();
		body.innerHTML = "first<br>second<div>third</div>";
		expect(readRunsFromDom(body)).toEqual([{ text: "first\nsecond\nthird" }]);
	});

	it("inherits the styled span when the browser nests typed text inside it", () => {
		const body = mountBody();
		appendRunsTo(body, [{ text: "bold", bold: true }]);
		const span = body.querySelector("span") as HTMLElement;
		span.appendChild(document.createTextNode("er"));
		expect(readRunsFromDom(body)).toEqual([{ text: "bolder", bold: true }]);
	});

	it("flattens unknown pasted markup to inherited-style text", () => {
		const body = mountBody();
		body.innerHTML = "<em>fancy</em> and <code>code</code>";
		expect(readRunsFromDom(body)).toEqual([{ text: "fancy and code" }]);
	});
});

describe("selection offsets", () => {
	it("maps a DOM selection to plain offsets and restores it after a rebuild", () => {
		const body = mountBody();
		appendRunsTo(body, [{ text: "Hello " }, { text: "world", bold: true }]);
		// Select "lo wo": offsets 3..8 across the text node + span boundary.
		selectOffsets(body, 3, 8);
		expect(domRangeOffsets(body)).toEqual({ start: 3, end: 8 });
		appendRunsTo(body, [{ text: "Hello world" }]);
		selectOffsets(body, 3, 8);
		expect(domRangeOffsets(body)).toEqual({ start: 3, end: 8 });
	});

	it("returns null when the selection is outside the body", () => {
		const body = mountBody();
		appendRunsTo(body, [{ text: "abc" }]);
		const outside = document.createElement("div");
		outside.textContent = "elsewhere";
		document.body.appendChild(outside);
		const range = document.createRange();
		range.selectNodeContents(outside);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		expect(domRangeOffsets(body)).toBeNull();
	});

	it("resolves element-anchored positions (triple-click style ranges)", () => {
		const body = mountBody();
		appendRunsTo(body, [{ text: "Hello " }, { text: "world", bold: true }]);
		const range = document.createRange();
		// Anchor on the body element itself: before child 0 → 0, after both → 11.
		range.setStart(body, 0);
		range.setEnd(body, 2);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		expect(domRangeOffsets(body)).toEqual({ start: 0, end: 11 });
	});
});
