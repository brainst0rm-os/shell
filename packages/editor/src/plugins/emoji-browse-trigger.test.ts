/**
 * `emojiBrowseInsertText` (B11.2) — the boundary rule the shared emoji-browse
 * trigger uses (the `Mod+e` chord + the inline-toolbar "Emoji" overflow row).
 * A `:` is prefixed with a space only when the preceding char isn't already a
 * break, so `detectEmojiTrigger` accepts the inserted trigger.
 */

import { describe, expect, it } from "vitest";
import { emojiBrowseInsertText } from "./emoji-typeahead-plugin";

describe("emojiBrowseInsertText", () => {
	it("prefixes a space after a word char", () => {
		expect(emojiBrowseInsertText("hello")).toBe(" :");
		expect(emojiBrowseInsertText("a")).toBe(" :");
	});

	it("omits the space when the caret already follows whitespace", () => {
		expect(emojiBrowseInsertText("hi ")).toBe(":");
	});

	it("omits the space at the start of an empty block", () => {
		expect(emojiBrowseInsertText("")).toBe(":");
	});

	it("treats an opening bracket as a break (no extra space)", () => {
		expect(emojiBrowseInsertText("(")).toBe(":");
		expect(emojiBrowseInsertText("see [")).toBe(":");
	});
});
