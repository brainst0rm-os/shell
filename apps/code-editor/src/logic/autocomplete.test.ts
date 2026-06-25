import { describe, expect, it } from "vitest";
import {
	CompletionKind,
	applyCompletion,
	bufferIdentifiers,
	completionPrefix,
	computeCompletions,
} from "./autocomplete";

describe("completionPrefix", () => {
	it("returns the prefix typed before the caret and the full word range", () => {
		const text = "const colorValue = col";
		expect(completionPrefix(text, text.length)).toEqual({ prefix: "col", from: 19, to: 22 });
	});

	it("uses only the chars before the caret but spans the whole word", () => {
		// caret after "co" inside "color"
		const got = completionPrefix("a color b", 4);
		expect(got).toEqual({ prefix: "co", from: 2, to: 7 });
	});

	it("returns null at the very start of a word (no prefix typed)", () => {
		expect(completionPrefix("alpha beta", 6)).toBeNull();
	});

	it("returns null when the caret touches no word character", () => {
		expect(completionPrefix("a + b", 2)).toBeNull();
	});

	it("treats unicode letters and underscores as word characters", () => {
		const text = "_naïveCount";
		expect(completionPrefix(text, text.length)?.prefix).toBe("_naïveCount");
	});
});

describe("bufferIdentifiers", () => {
	it("counts identifiers and ignores pure numbers and single chars", () => {
		const counts = bufferIdentifiers("total total sum 42 x");
		expect(counts.get("total")).toBe(2);
		expect(counts.get("sum")).toBe(1);
		expect(counts.has("42")).toBe(false);
		expect(counts.has("x")).toBe(false);
	});
});

describe("computeCompletions", () => {
	it("completes a prefix from other identifiers in the buffer", () => {
		const text = "function calculate() {}\ncalc";
		const result = computeCompletions(text, text.length);
		expect(result?.items.map((i) => i.label)).toContain("calculate");
		expect(result?.from).toBe(24);
		expect(result?.to).toBe(28);
	});

	it("excludes the word being typed from its own completions", () => {
		const text = "alpha\nalp";
		const labels = computeCompletions(text, text.length)?.items.map((i) => i.label) ?? [];
		expect(labels).toContain("alpha");
		expect(labels).not.toContain("alp");
	});

	it("returns null when the only candidate is the word already fully typed", () => {
		expect(computeCompletions("alpha alpha", 11)).toBeNull();
	});

	it("matches case-insensitively but ranks a case-exact match first", () => {
		const text = "Colorize colander co";
		const items = computeCompletions(text, text.length)?.items ?? [];
		expect(items[0]?.label).toBe("colander"); // exact-case prefix "co" beats "Colorize"
		expect(items.map((i) => i.label)).toContain("Colorize");
	});

	it("ranks higher-frequency identifiers ahead of rarer ones", () => {
		const text = "value value value vary v\nvalue vary va";
		const labels = (computeCompletions(text, text.length)?.items ?? []).map((i) => i.label);
		expect(labels[0]).toBe("value");
		expect(labels.indexOf("value")).toBeLessThan(labels.indexOf("vary"));
	});

	it("layers injected keywords after buffer identifiers and tags them", () => {
		const text = "retry re";
		const result = computeCompletions(text, text.length, { keywords: ["return", "retry"] });
		const labels = result?.items.map((i) => i.label) ?? [];
		expect(labels).toContain("retry");
		expect(labels).toContain("return");
		// "retry" comes from the buffer (freq 1) and ranks before the keyword "return"
		expect(labels.indexOf("retry")).toBeLessThan(labels.indexOf("return"));
		expect(result?.items.find((i) => i.label === "return")?.kind).toBe(CompletionKind.Keyword);
	});

	it("de-duplicates a label shared by the buffer and the keyword list", () => {
		const text = "return retur";
		const result = computeCompletions(text, text.length, { keywords: ["return"] });
		const returns = result?.items.filter((i) => i.label === "return") ?? [];
		expect(returns).toHaveLength(1);
		expect(returns[0]?.kind).toBe(CompletionKind.Word);
	});

	it("honours the minimum-prefix threshold", () => {
		const text = "alpha a";
		expect(computeCompletions(text, text.length, { minPrefix: 2 })).toBeNull();
		expect(computeCompletions(text, text.length, { minPrefix: 1 })).not.toBeNull();
	});

	it("caps the list to maxItems", () => {
		const text = "ax1 ax2 ax3 ax4 ax5 axx\nax";
		const result = computeCompletions(text, text.length, { maxItems: 3 });
		expect(result?.items).toHaveLength(3);
	});

	it("returns null when there is no prefix or no candidate", () => {
		expect(computeCompletions("", 0)).toBeNull();
		expect(computeCompletions("zzz qqq", 7)).toBeNull(); // "qqq" only itself, no other match
	});

	it("replaces the whole word when the caret is mid-word (no duplication)", () => {
		const text = "colorful\ncol or"; // caret after "col" in "col or"? place explicitly
		const caret = "colorful\ncol".length;
		const result = computeCompletions(text, caret);
		expect(result).not.toBeNull();
		if (!result) return;
		// from/to span the word under the caret ("col"), to is its end
		expect(text.slice(result.from, result.to)).toBe("col");
	});
});

describe("applyCompletion", () => {
	it("replaces the range and positions the caret after the inserted text", () => {
		const doc = "colorize\nx = col";
		const result = computeCompletions(doc, doc.length);
		expect(result).not.toBeNull();
		if (!result) return;
		const applied = applyCompletion(doc, result, { insertText: "colorize" });
		expect(applied.text).toBe("colorize\nx = colorize");
		expect(applied.caret).toBe("colorize\nx = colorize".length);
	});

	it("does not duplicate the suffix when completing mid-word", () => {
		// "foobar" with caret after "foo" → accepting "foobar" replaces the whole word
		const text = "foobar\nfoo";
		const result = computeCompletions(text, text.length);
		expect(result).not.toBeNull();
		if (!result) return;
		const applied = applyCompletion(text, result, { insertText: "foobar" });
		expect(applied.text).toBe("foobar\nfoobar");
	});
});
