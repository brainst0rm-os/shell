import { describe, expect, it } from "vitest";
import { DEFAULT_SNIPPET_LENGTH, clipPlainText } from "./clip-plain-text";

describe("clipPlainText", () => {
	it("returns empty for empty input", () => {
		expect(clipPlainText("")).toBe("");
	});

	it("returns empty for whitespace-only input", () => {
		expect(clipPlainText("   \n\t  ")).toBe("");
	});

	it("collapses and trims surrounding whitespace", () => {
		expect(clipPlainText("  hello world  ")).toBe("hello world");
	});

	it("collapses interior runs of whitespace", () => {
		expect(clipPlainText("alpha   beta\n\tgamma")).toBe("alpha beta gamma");
	});

	it("passes through short input unchanged", () => {
		const out = clipPlainText("short");
		expect(out).toBe("short");
	});

	it("clips at the default length with an ellipsis", () => {
		const out = clipPlainText("a".repeat(DEFAULT_SNIPPET_LENGTH + 50));
		expect(out.length).toBe(DEFAULT_SNIPPET_LENGTH + 1);
		expect(out.endsWith("…")).toBe(true);
	});

	it("does not clip input exactly at the limit", () => {
		const out = clipPlainText("a".repeat(DEFAULT_SNIPPET_LENGTH));
		expect(out.length).toBe(DEFAULT_SNIPPET_LENGTH);
		expect(out.endsWith("…")).toBe(false);
	});

	it("honours a custom max length", () => {
		expect(clipPlainText("hello world", 5)).toBe("hello…");
	});

	it("is idempotent on already-collapsed input (extractPlainText producer contract)", () => {
		const once = clipPlainText("alpha   beta\ngamma", 50);
		const twice = clipPlainText(once, 50);
		expect(twice).toBe(once);
	});
});
