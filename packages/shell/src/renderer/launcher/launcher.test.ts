import { describe, expect, it } from "vitest";
import { prettyEntityType, sanitizeSnippet } from "./launcher-text";

describe("sanitizeSnippet", () => {
	it("preserves literal <mark> tags emitted by FTS5", () => {
		expect(sanitizeSnippet("a <mark>hit</mark> word")).toBe("a <mark>hit</mark> word");
	});

	it("escapes other HTML in the snippet body", () => {
		expect(sanitizeSnippet("<script>x</script>")).toBe("&lt;script&gt;x&lt;/script&gt;");
	});

	it("escapes angle brackets while keeping <mark>", () => {
		expect(sanitizeSnippet("<b><mark>x</mark></b>")).toBe("&lt;b&gt;<mark>x</mark>&lt;/b&gt;");
	});

	it("escapes attribute quoting", () => {
		expect(sanitizeSnippet(`<img src="x" onerror="y">`)).toBe(
			"&lt;img src=&quot;x&quot; onerror=&quot;y&quot;&gt;",
		);
	});

	it("escapes ampersands", () => {
		expect(sanitizeSnippet("AT&T")).toBe("AT&amp;T");
	});

	it("returns the empty string for empty input", () => {
		expect(sanitizeSnippet("")).toBe("");
	});

	it("never produces an unmatched <mark>", () => {
		const out = sanitizeSnippet("<mark>only opener and <fake>");
		// The opener marker survives, the bogus <fake> is escaped.
		expect(out).toBe("<mark>only opener and &lt;fake&gt;");
	});
});

describe("prettyEntityType", () => {
	it("extracts the type from a full bp-style id", () => {
		expect(prettyEntityType("io.brainstorm.notes/Note/v1")).toBe("Note");
		expect(prettyEntityType("io.brainstorm.tasks/Task/v2")).toBe("Task");
	});

	it("returns the raw id when the shape doesn't match", () => {
		expect(prettyEntityType("Note")).toBe("Note");
		expect(prettyEntityType("io/Note")).toBe("io/Note");
		expect(prettyEntityType("")).toBe("");
	});
});
