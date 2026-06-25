import { describe, expect, it } from "vitest";
import { slideLines, slidesFromEntries } from "./pptx-text";

const enc = (s: string) => new TextEncoder().encode(s);

describe("slideLines", () => {
	it("collects one line per paragraph, joining text runs", () => {
		const xml =
			"<p:sld><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>world</a:t></a:r></a:p>" +
			"<a:p><a:t>Second line</a:t></a:p></p:sld>";
		expect(slideLines(xml)).toEqual(["Hello world", "Second line"]);
	});

	it("decodes XML entities and skips empty paragraphs", () => {
		const xml = "<a:p><a:t>A &amp; B &lt;ok&gt;</a:t></a:p><a:p></a:p><a:p><a:t>   </a:t></a:p>";
		expect(slideLines(xml)).toEqual(["A & B <ok>"]);
	});
});

describe("slidesFromEntries", () => {
	it("orders slides by numeric suffix and ignores non-slide entries", () => {
		const entries: Record<string, Uint8Array> = {
			"ppt/slides/slide10.xml": enc("<a:p><a:t>Ten</a:t></a:p>"),
			"ppt/slides/slide2.xml": enc("<a:p><a:t>Two</a:t></a:p>"),
			"ppt/slides/slide1.xml": enc("<a:p><a:t>One</a:t></a:p>"),
			"ppt/presentation.xml": enc("<x/>"),
			"docProps/app.xml": enc("<x/>"),
		};
		const slides = slidesFromEntries(entries);
		expect(slides.map((s) => s.index)).toEqual([1, 2, 10]);
		expect(slides.map((s) => s.lines[0])).toEqual(["One", "Two", "Ten"]);
	});

	it("keeps an empty slide (faithful count) with no lines", () => {
		const slides = slidesFromEntries({ "ppt/slides/slide1.xml": enc("<p:sld></p:sld>") });
		expect(slides).toEqual([{ index: 1, lines: [] }]);
	});
});
