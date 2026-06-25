import { describe, expect, it } from "vitest";
import { detectEmojiTrigger } from "./emoji-typeahead-ops";

describe("detectEmojiTrigger", () => {
	it("triggers on `:query` at the start of the block", () => {
		expect(detectEmojiTrigger(":grin", 5)).toEqual({ triggerOffset: 0, query: "grin" });
	});

	it("triggers after whitespace", () => {
		expect(detectEmojiTrigger("hi :grin", 8)).toEqual({ triggerOffset: 3, query: "grin" });
	});

	it("does NOT trigger inside a word (`12:30`, `http://`)", () => {
		expect(detectEmojiTrigger("12:30", 5)).toBeNull();
		expect(detectEmojiTrigger("http://x", 8)).toBeNull();
	});

	it("does not trigger on a bare `:` (empty query)", () => {
		expect(detectEmojiTrigger("a :", 3)).toBeNull();
	});

	it("rejects a query containing whitespace (already left the context)", () => {
		expect(detectEmojiTrigger(":grin face", 10)).toBeNull();
	});

	it("rejects non-shortcode characters in the query", () => {
		expect(detectEmojiTrigger(":gr/in", 6)).toBeNull();
	});

	it("accepts underscores + digits (real slug shape)", () => {
		expect(detectEmojiTrigger(":grinning_face_2", 16)).toEqual({
			triggerOffset: 0,
			query: "grinning_face_2",
		});
	});

	it("returns null when the caret is before any `:`", () => {
		expect(detectEmojiTrigger("hello", 5)).toBeNull();
	});

	it("rejects a bare `:` by default (no chord)", () => {
		expect(detectEmojiTrigger("a :", 3)).toBeNull();
	});

	it("accepts a bare `:` at a boundary when allowEmpty (chord-opened browse)", () => {
		expect(detectEmojiTrigger("a :", 3, true)).toEqual({ triggerOffset: 2, query: "" });
		expect(detectEmojiTrigger(":", 1, true)).toEqual({ triggerOffset: 0, query: "" });
	});

	it("still rejects a bare `:` mid-word even with allowEmpty", () => {
		expect(detectEmojiTrigger("12:", 3, true)).toBeNull();
	});
});
