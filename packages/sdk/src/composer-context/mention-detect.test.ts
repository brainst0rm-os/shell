import { describe, expect, it } from "vitest";
import { MENTION_QUERY_MAX, clearMentionToken, detectMention } from "./mention-detect";

describe("detectMention", () => {
	it("detects a mention at the start of the text", () => {
		expect(detectMention("@sol", 4)).toEqual({ query: "sol", start: 0 });
	});

	it("detects a mention after whitespace", () => {
		expect(detectMention("hi @sol", 7)).toEqual({ query: "sol", start: 3 });
		expect(detectMention("a\n@b", 4)).toEqual({ query: "b", start: 2 });
	});

	it("returns the empty query right after the trigger", () => {
		expect(detectMention("hi @", 4)).toEqual({ query: "", start: 3 });
	});

	it("does not fire mid-word (e.g. an email)", () => {
		expect(detectMention("mail me at a@b.com", 13)).toBeNull();
	});

	it("closes the token at whitespace before the caret", () => {
		expect(detectMention("@sol said hi", 12)).toBeNull();
	});

	it("uses the most recent trigger before the caret", () => {
		expect(detectMention("@one @two", 9)).toEqual({ query: "two", start: 5 });
	});

	it("returns null when there is no trigger", () => {
		expect(detectMention("just text", 9)).toBeNull();
	});

	it("guards against an out-of-range caret", () => {
		expect(detectMention("@x", -1)).toBeNull();
		expect(detectMention("@x", 99)).toBeNull();
	});

	it("rejects a query longer than the cap", () => {
		const long = `@${"a".repeat(MENTION_QUERY_MAX + 1)}`;
		expect(detectMention(long, long.length)).toBeNull();
	});
});

describe("clearMentionToken", () => {
	it("removes the @query run and returns the caret to the trigger", () => {
		const match = { query: "sol", start: 3 };
		expect(clearMentionToken("hi @sol there", match, 7)).toEqual({
			text: "hi  there",
			caret: 3,
		});
	});

	it("handles a mention at the end of the text", () => {
		const match = { query: "do", start: 0 };
		expect(clearMentionToken("@do", match, 3)).toEqual({ text: "", caret: 0 });
	});
});
