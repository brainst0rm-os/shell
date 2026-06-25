import { describe, expect, it } from "vitest";
import type { SerializedEditorStateLike } from "./preview";
import { serializedStateToHtml } from "./serialize-html";

function doc(children: unknown[]): SerializedEditorStateLike {
	return { root: { type: "root", children } } as SerializedEditorStateLike;
}
const text = (t: string, format = 0) => ({ type: "text", text: t, format });

describe("serializedStateToHtml", () => {
	it("returns '' for empty / malformed / string-garbage input", () => {
		expect(serializedStateToHtml(null)).toBe("");
		expect(serializedStateToHtml({} as never)).toBe("");
		expect(serializedStateToHtml("{not json")).toBe("");
	});

	it("renders paragraphs, headings, quotes, lists", () => {
		const html = serializedStateToHtml(
			doc([
				{ type: "paragraph", children: [text("hi")] },
				{ type: "heading", tag: "h3", children: [text("Title")] },
				{ type: "quote", children: [text("q")] },
				{
					type: "list",
					listType: "number",
					children: [{ type: "listitem", children: [text("one")] }],
				},
			]),
		);
		expect(html).toBe("<p>hi</p><h3>Title</h3><blockquote>q</blockquote><ol><li>one</li></ol>");
	});

	it("clamps an unknown heading tag to h2 and bullet lists to ul", () => {
		expect(serializedStateToHtml(doc([{ type: "heading", tag: "h9", children: [text("x")] }]))).toBe(
			"<h2>x</h2>",
		);
		expect(
			serializedStateToHtml(
				doc([{ type: "list", children: [{ type: "listitem", children: [text("a")] }] }]),
			),
		).toBe("<ul><li>a</li></ul>");
	});

	it("wraps text format bits (bold/italic/underline/strike/code), inner-out", () => {
		// Bold|Italic = 1|2 = 3
		expect(serializedStateToHtml(doc([{ type: "paragraph", children: [text("x", 3)] }]))).toBe(
			"<p><strong><em>x</em></strong></p>",
		);
		expect(serializedStateToHtml(doc([{ type: "paragraph", children: [text("c", 16)] }]))).toBe(
			"<p><code>c</code></p>",
		);
	});

	it("HTML-escapes text content (no markup injection)", () => {
		const html = serializedStateToHtml(
			doc([{ type: "paragraph", children: [text('<script>alert(1)</script> & "q"')] }]),
		);
		expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;</p>");
		expect(html).not.toContain("<script>");
	});

	it("keeps safe link hrefs but drops javascript: / unknown schemes", () => {
		const safe = serializedStateToHtml(
			doc([{ type: "link", url: "https://x.com/a?b=1", children: [text("link")] }]),
		);
		expect(safe).toBe('<a href="https://x.com/a?b=1" rel="noreferrer">link</a>');

		const danger = serializedStateToHtml(
			doc([{ type: "link", url: "javascript:alert(1)", children: [text("x")] }]),
		);
		expect(danger).toBe("<a>x</a>"); // href dropped, no executable URL
		expect(danger).not.toContain("javascript:");
	});

	it("escapes the brainstorm:// entity href (internal links survive)", () => {
		const html = serializedStateToHtml(
			doc([{ type: "link", url: "brainstorm://entity/n_1", children: [text("ref")] }]),
		);
		expect(html).toBe('<a href="brainstorm://entity/n_1" rel="noreferrer">ref</a>');
	});

	it("renders images with escaped src/alt and drops an unsafe src", () => {
		expect(
			serializedStateToHtml(doc([{ type: "image", src: "https://x/y.png", altText: 'a"b' }])),
		).toBe('<img src="https://x/y.png" alt="a&quot;b" />');
		expect(serializedStateToHtml(doc([{ type: "image", src: "javascript:1", altText: "x" }]))).toBe(
			"",
		);
	});

	it("emits <br /> for linebreaks and respects maxBlocks", () => {
		expect(
			serializedStateToHtml(doc([{ type: "paragraph", children: [{ type: "linebreak" }] }])),
		).toBe("<p><br /></p>");
		const many = doc([
			{ type: "paragraph", children: [text("1")] },
			{ type: "paragraph", children: [text("2")] },
		]);
		expect(serializedStateToHtml(many, { maxBlocks: 1 })).toBe("<p>1</p>");
	});

	it("falls back to a decorator node's escaped plain text", () => {
		expect(
			serializedStateToHtml(
				doc([{ type: "paragraph", children: [{ type: "mention", text: "@A & B" }] }]),
			),
		).toBe("<p>@A &amp; B</p>");
	});
});
