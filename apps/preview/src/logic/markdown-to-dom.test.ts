// @vitest-environment jsdom
/**
 * Tests for the markdown parser + DOM builder. The XSS-safe-by-construction
 * claim is the load-bearing test — every assertion that pushes user-supplied
 * strings through the parser must come out as a text node, never raw HTML.
 */

import { describe, expect, it } from "vitest";
import {
	BlockKind,
	isSafeLinkUrl,
	parseMarkdown,
	renderBlocksToDom,
	renderInlineInto,
	wordCountForMarkdown,
} from "./markdown-to-dom";

function withDocument<T>(fn: (doc: Document) => T): T {
	// Vitest provides a JSDOM-ish global `document` in the default
	// test env — this app's vitest config inherits the root setup.
	return fn(globalThis.document);
}

describe("parseMarkdown", () => {
	it("parses headings at levels 1..4", () => {
		const blocks = parseMarkdown("# A\n## B\n### C\n#### D");
		expect(blocks).toEqual([
			{ kind: BlockKind.Heading, level: 1, text: "A" },
			{ kind: BlockKind.Heading, level: 2, text: "B" },
			{ kind: BlockKind.Heading, level: 3, text: "C" },
			{ kind: BlockKind.Heading, level: 4, text: "D" },
		]);
	});

	it("merges contiguous non-special lines into one paragraph; blank line ends the paragraph", () => {
		const blocks = parseMarkdown("hello\nworld\n\nnext");
		expect(blocks).toEqual([
			{ kind: BlockKind.Paragraph, text: "hello world" },
			{ kind: BlockKind.Paragraph, text: "next" },
		]);
	});

	it("parses fenced code blocks with optional language hint", () => {
		const src = "```ts\nconst x = 1;\n```";
		const blocks = parseMarkdown(src);
		expect(blocks).toEqual([{ kind: BlockKind.CodeFence, language: "ts", code: "const x = 1;" }]);
	});

	it("parses bullet and ordered lists", () => {
		const blocks = parseMarkdown("- a\n- b\n\n1. one\n2. two");
		expect(blocks[0]).toEqual({ kind: BlockKind.BulletList, items: ["a", "b"] });
		expect(blocks[1]).toEqual({ kind: BlockKind.OrderedList, items: ["one", "two"] });
	});

	it("parses --- as a horizontal rule", () => {
		const blocks = parseMarkdown("para\n\n---\n\nafter");
		expect(blocks.some((b) => b.kind === BlockKind.HorizontalRule)).toBe(true);
	});
});

describe("renderBlocksToDom", () => {
	it("emits the expected DOM shape for a mixed document", () => {
		withDocument((doc) => {
			const blocks = parseMarkdown("# Hi\n\nplain *italic* and **bold** and `code`.");
			const root = renderBlocksToDom(blocks, doc);
			expect(root.querySelectorAll("h1").length).toBe(1);
			expect(root.querySelectorAll("p").length).toBe(1);
			expect(root.querySelectorAll("em").length).toBe(1);
			expect(root.querySelectorAll("strong").length).toBe(1);
			expect(root.querySelectorAll("code").length).toBe(1);
		});
	});

	it("never sets innerHTML — even if the markdown contains raw HTML strings, they become text nodes", () => {
		withDocument((doc) => {
			const evil = "<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>";
			const root = renderBlocksToDom(parseMarkdown(evil), doc);
			expect(root.querySelectorAll("script").length).toBe(0);
			expect(root.querySelectorAll("img").length).toBe(0);
			// The "<script>…" text survives as a text node inside the paragraph.
			expect(root.textContent).toContain("<script>");
		});
	});

	it("strips unsafe link schemes — javascript:/data: become plain text, not anchors", () => {
		withDocument((doc) => {
			const md = "[click](javascript:alert(1)) and [also](data:text/html,<script>x</script>)";
			const root = renderBlocksToDom(parseMarkdown(md), doc);
			expect(root.querySelectorAll("a").length).toBe(0);
			expect(root.textContent).toContain("[click]");
			expect(root.textContent).toContain("[also]");
		});
	});

	it("renders safe links with rel + target attrs", () => {
		withDocument((doc) => {
			const md = "[home](https://example.invalid)";
			const root = renderBlocksToDom(parseMarkdown(md), doc);
			const a = root.querySelector("a");
			expect(a?.getAttribute("href")).toBe("https://example.invalid");
			expect(a?.getAttribute("rel")).toBe("noreferrer noopener");
			expect(a?.getAttribute("target")).toBe("_blank");
			expect(a?.textContent).toBe("home");
		});
	});

	it("renders code fences with whitespace preserved", () => {
		withDocument((doc) => {
			const md = "```\n  indented\n  more\n```";
			const root = renderBlocksToDom(parseMarkdown(md), doc);
			const code = root.querySelector("pre code");
			expect(code?.textContent).toBe("  indented\n  more");
		});
	});
});

describe("renderInlineInto", () => {
	it("handles unclosed marks gracefully — leftover * stays as plain text", () => {
		withDocument((doc) => {
			const p = doc.createElement("p");
			renderInlineInto("*never closed", p, doc);
			expect(p.querySelector("em")).toBeNull();
			expect(p.textContent).toBe("*never closed");
		});
	});
});

describe("isSafeLinkUrl", () => {
	it("accepts http/https/mailto/brainstorm", () => {
		expect(isSafeLinkUrl("http://x")).toBe(true);
		expect(isSafeLinkUrl("https://x")).toBe(true);
		expect(isSafeLinkUrl("mailto:a@b")).toBe(true);
		expect(isSafeLinkUrl("brainstorm://entity/abc")).toBe(true);
	});

	it("rejects javascript / data / unknown / empty", () => {
		expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
		expect(isSafeLinkUrl("data:text/html,<x>")).toBe(false);
		expect(isSafeLinkUrl("file:///etc/passwd")).toBe(false);
		expect(isSafeLinkUrl("")).toBe(false);
	});

	it("is case-insensitive on the scheme", () => {
		expect(isSafeLinkUrl("HTTPS://x")).toBe(true);
	});
});

describe("wordCountForMarkdown", () => {
	it("counts paragraph + heading + list words; ignores code fences", () => {
		const md =
			"# A heading\n\nA short paragraph here.\n\n- item one\n- item two\n\n```\ncode words not counted at all\n```";
		expect(wordCountForMarkdown(md)).toBe(
			2 + // heading
				4 + // paragraph
				2 + // item one
				2, // item two
		);
	});
});
