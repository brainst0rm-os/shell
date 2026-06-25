import { describe, expect, it } from "vitest";
import { DEFAULT_SNIPPET_LENGTH } from "./clip-plain-text";
import { denormalizeBody } from "./denormalize-body";
import { extractPlainText } from "./extract-text";
import { extractTitle } from "./extract-title";
import { TITLE_NODE_TYPE } from "./nodes/title-node";

const ROOT_BASE = {
	type: "root" as const,
	version: 1,
	format: "",
	indent: 0,
	direction: null,
};

function bodyWith(...children: unknown[]) {
	return { root: { ...ROOT_BASE, children } } as never;
}

describe("extractTitle", () => {
	it("returns empty for null / undefined / string bodies", () => {
		expect(extractTitle(null)).toBe("");
		expect(extractTitle(undefined)).toBe("");
		expect(extractTitle("legacy plain text")).toBe("");
	});

	it("returns empty when the first root child is not a TitleNode", () => {
		const body = bodyWith({ type: "paragraph", children: [{ type: "text", text: "hello" }] });
		expect(extractTitle(body)).toBe("");
	});

	it("flattens text children of a TitleNode", () => {
		const body = bodyWith({
			type: TITLE_NODE_TYPE,
			children: [
				{ type: "text", text: "Hello " },
				{ type: "text", text: "world" },
			],
		});
		expect(extractTitle(body)).toBe("Hello world");
	});

	it("includes label-bearing inline chips prefixed with @ (mirrors the rendered mention)", () => {
		const body = bodyWith({
			type: TITLE_NODE_TYPE,
			children: [
				{ type: "text", text: "Re: " },
				{ type: "mention", label: "Andrew" },
			],
		});
		expect(extractTitle(body)).toBe("Re: @Andrew");
	});

	it("collapses runs of whitespace and trims", () => {
		const body = bodyWith({
			type: TITLE_NODE_TYPE,
			children: [{ type: "text", text: "  spaced   out\n  " }],
		});
		expect(extractTitle(body)).toBe("spaced out");
	});
});

describe("extractPlainText", () => {
	it("returns empty for nullish input", () => {
		expect(extractPlainText(null)).toBe("");
		expect(extractPlainText(undefined)).toBe("");
	});

	it("collapses a raw string", () => {
		expect(extractPlainText("  raw   text\n")).toBe("raw text");
	});

	it("flattens nested block + inline content across the whole body", () => {
		const body = bodyWith(
			{ type: TITLE_NODE_TYPE, children: [{ type: "text", text: "Title" }] },
			{ type: "paragraph", children: [{ type: "text", text: "first line" }] },
			{ type: "paragraph", children: [{ type: "text", text: "second" }] },
		);
		expect(extractPlainText(body)).toBe("Title first line second");
	});

	it("includes inline chip labels without the @ prefix", () => {
		const body = bodyWith({
			type: "paragraph",
			children: [
				{ type: "text", text: "ping" },
				{ type: "mention", label: "Andrew" },
			],
		});
		expect(extractPlainText(body)).toBe("ping Andrew");
	});
});

describe("denormalizeBody", () => {
	it("returns empty mirrors for an empty body", () => {
		expect(denormalizeBody(null)).toEqual({ title: "", snippet: "", wordCount: 0 });
	});

	it("produces both the title and a clipped plain-text snippet", () => {
		const body = bodyWith(
			{ type: TITLE_NODE_TYPE, children: [{ type: "text", text: "My day" }] },
			{ type: "paragraph", children: [{ type: "text", text: "wrote some things" }] },
		);
		expect(denormalizeBody(body)).toEqual({
			title: "My day",
			snippet: "My day wrote some things",
			wordCount: 5,
		});
	});

	it("clips the snippet to the default length while leaving the title intact", () => {
		const long = "word ".repeat(200).trim();
		const body = bodyWith(
			{ type: TITLE_NODE_TYPE, children: [{ type: "text", text: "Heading" }] },
			{ type: "paragraph", children: [{ type: "text", text: long }] },
		);
		const { title, snippet } = denormalizeBody(body);
		expect(title).toBe("Heading");
		expect(snippet.length).toBe(DEFAULT_SNIPPET_LENGTH + 1);
		expect(snippet.endsWith("…")).toBe(true);
	});

	it("counts words over the WHOLE body, not the clipped snippet (F-012)", () => {
		const long = "word ".repeat(200).trim();
		const body = bodyWith(
			{ type: TITLE_NODE_TYPE, children: [{ type: "text", text: "Heading" }] },
			{ type: "paragraph", children: [{ type: "text", text: long }] },
		);
		const { snippet, wordCount } = denormalizeBody(body);
		// The snippet caps at ~20 words; the count must reflect all 201.
		expect(wordCount).toBe(201);
		expect(snippet.split(" ").length).toBeLessThan(wordCount);
	});
});
