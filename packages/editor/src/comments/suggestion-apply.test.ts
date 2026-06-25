// @vitest-environment jsdom
import { createHeadlessEditor } from "@lexical/headless";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	type LexicalEditor,
	type NodeKey,
} from "lexical";
import { describe, expect, it } from "vitest";
import { applySuggestionInEditor } from "./suggestion-apply";

function createEditor(): LexicalEditor {
	return createHeadlessEditor({
		nodes: [],
		onError(error) {
			throw error;
		},
	});
}

/** Seed one paragraph whose text is split across the given runs (separate
 *  TextNodes, as bold/colour spans produce) and return its block key. */
function seedParagraph(editor: LexicalEditor, runs: string[]): NodeKey {
	let key = "";
	editor.update(
		() => {
			const p = $createParagraphNode();
			for (const run of runs) p.append($createTextNode(run));
			$getRoot().clear().append(p);
			key = p.getKey();
		},
		{ discrete: true },
	);
	return key;
}

function blockText(editor: LexicalEditor): string {
	let text = "";
	editor.getEditorState().read(() => {
		text = $getRoot().getTextContent();
	});
	return text;
}

describe("applySuggestionInEditor", () => {
	it("replaces the quote inside a single text node", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["the quick brown fox"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "quick brown" },
			"slow red",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("the slow red fox");
	});

	it("replaces a quote spanning two text runs", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["the quick ", "brown fox jumps"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "quick brown" },
			"lazy grey",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("the lazy grey fox jumps");
	});

	it("an empty replacement deletes the quote", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["keep remove keep"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: " remove" },
			"",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("keep keep");
	});

	it("returns false without mutating when the quote no longer occurs", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["completely different text"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "quick brown" },
			"anything",
		);
		expect(ok).toBe(false);
		expect(blockText(editor)).toBe("completely different text");
	});

	it("returns false for a stale block key", () => {
		const editor = createEditor();
		seedParagraph(editor, ["some text"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: "999", quote: "some" },
			"any",
		);
		expect(ok).toBe(false);
	});

	it("returns false when the anchor has no quote or the suggestion no replacement", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["some text"]);
		expect(applySuggestionInEditor(editor, { entityId: "doc", blockId: key }, "any")).toBe(false);
		expect(
			applySuggestionInEditor(editor, { entityId: "doc", blockId: key, quote: "some" }, undefined),
		).toBe(false);
	});

	it("edits the occurrence the anchor range points at, not the first match", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["foo bar foo"]);
		// Range targets the SECOND "foo" (offsets 8..11).
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "foo", range: { start: 8, end: 11 } },
			"baz",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("foo bar baz");
	});

	it("honours a range that points at the first occurrence too", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["foo bar foo"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "foo", range: { start: 0, end: 3 } },
			"baz",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("baz bar foo");
	});

	it("returns false when the text drifted so the range no longer holds the quote (stale)", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["foo bar foo"]);
		// Range/quote claim "foo" at 8..11 but the block now reads otherwise there.
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "foo", range: { start: 4, end: 7 } },
			"baz",
		);
		expect(ok).toBe(false);
		expect(blockText(editor)).toBe("foo bar foo");
	});

	it("returns false for a range that runs past the block's current text (stale)", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["short"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "short", range: { start: 0, end: 99 } },
			"x",
		);
		expect(ok).toBe(false);
		expect(blockText(editor)).toBe("short");
	});

	it("returns false for an ambiguous multi-occurrence quote with no range", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["foo bar foo"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "foo" },
			"baz",
		);
		expect(ok).toBe(false);
		expect(blockText(editor)).toBe("foo bar foo");
	});

	it("still applies a single-occurrence quote with no range (indexOf fallback)", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["one and only target here"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "target" },
			"prize",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("one and only prize here");
	});

	it("returns false for a quote that spans blocks (contains a newline)", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["first line"]);
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "first line\nsecond line" },
			"x",
		);
		expect(ok).toBe(false);
		expect(blockText(editor)).toBe("first line");
	});

	it("applies a range that spans two text runs", () => {
		const editor = createEditor();
		const key = seedParagraph(editor, ["the quick ", "brown fox jumps"]);
		// "quick brown" spans the run boundary at offset 4..15.
		const ok = applySuggestionInEditor(
			editor,
			{ entityId: "doc", blockId: key, quote: "quick brown", range: { start: 4, end: 15 } },
			"lazy grey",
		);
		expect(ok).toBe(true);
		expect(blockText(editor)).toBe("the lazy grey fox jumps");
	});
});
