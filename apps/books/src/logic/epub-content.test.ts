// @vitest-environment jsdom
/** EPUB content extraction (9.21.2) — htmlToBlocks turns section XHTML into
 *  Heading/Paragraph blocks; bookContentFrom assembles BookContent + drops
 *  text-less sections. */
import { describe, expect, it } from "vitest";
import { BlockKind } from "./content";
import { bookContentFrom, htmlToBlocks } from "./epub-content";

describe("htmlToBlocks", () => {
	it("maps headings and paragraphs, collapsing whitespace", () => {
		const blocks = htmlToBlocks("<h1>Chapter\n One</h1><p>Hello   world.</p><p>Second.</p>");
		expect(blocks).toEqual([
			{ kind: BlockKind.Heading, text: "Chapter One" },
			{ kind: BlockKind.Paragraph, text: "Hello world." },
			{ kind: BlockKind.Paragraph, text: "Second." },
		]);
	});

	it("descends through generic containers without duplicating nested text", () => {
		const blocks = htmlToBlocks("<div><section><h2>Title</h2><p>Body</p></section></div>");
		expect(blocks.map((b) => b.text)).toEqual(["Title", "Body"]);
	});

	it("skips script/style and empty blocks, treats li as paragraphs", () => {
		const blocks = htmlToBlocks(
			"<style>.x{}</style><p></p><ul><li>One</li><li>Two</li></ul><script>x()</script>",
		);
		expect(blocks.map((b) => b.text)).toEqual(["One", "Two"]);
	});

	it("falls back to a single paragraph for bare text", () => {
		expect(htmlToBlocks("just some loose text")).toEqual([
			{ kind: BlockKind.Paragraph, text: "just some loose text" },
		]);
	});
});

describe("bookContentFrom", () => {
	it("builds BookContent, dropping text-less sections", () => {
		const content = bookContentFrom({ title: "My Book", author: "Ada" }, [
			{ title: "Cover", html: "<img src='c.png'/>" },
			{ title: "Ch 1", html: "<h1>Ch 1</h1><p>Text</p>" },
		]);
		expect(content.title).toBe("My Book");
		expect(content.author).toBe("Ada");
		expect(content.spine).toHaveLength(1);
		expect(content.spine[0]?.title).toBe("Ch 1");
	});

	it("names untitled sections by index", () => {
		const content = bookContentFrom({ title: "T", author: "" }, [{ title: "", html: "<p>One</p>" }]);
		expect(content.spine[0]?.title).toBe("Chapter 1");
	});

	it("keeps one spine item even when every section is empty", () => {
		const content = bookContentFrom({ title: "Empty", author: "" }, [{ title: "", html: "<img/>" }]);
		expect(content.spine).toHaveLength(1);
		expect(content.spine[0]?.blocks).toEqual([]);
	});
});
