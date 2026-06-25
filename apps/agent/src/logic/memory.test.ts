import { describe, expect, it } from "vitest";
import {
	MEMORY_RECALL_TOP_K,
	MEMORY_TEXT_MAX,
	type MemoryItem,
	buildMemoryContextBlock,
	buildMemoryDraft,
	buildMemoryEdit,
	isMemoryEnabled,
	memoriesFromEntities,
	normalizeMemoryText,
	withMemoryContext,
} from "./memory";

describe("isMemoryEnabled — OFF by default / fail-safe", () => {
	it("is OFF for a missing / malformed flag", () => {
		expect(isMemoryEnabled(undefined)).toBe(false);
		expect(isMemoryEnabled(null)).toBe(false);
		expect(isMemoryEnabled("true")).toBe(false);
		expect(isMemoryEnabled(1)).toBe(false);
		expect(isMemoryEnabled(false)).toBe(false);
	});

	it("is ON only for a literal true", () => {
		expect(isMemoryEnabled(true)).toBe(true);
	});
});

describe("normalizeMemoryText", () => {
	it("collapses whitespace and trims", () => {
		expect(normalizeMemoryText("  a\n\t b   c ")).toBe("a b c");
	});

	it("clamps to the max with an ellipsis", () => {
		const long = "x".repeat(MEMORY_TEXT_MAX + 50);
		const out = normalizeMemoryText(long);
		expect(out.length).toBe(MEMORY_TEXT_MAX);
		expect(out.endsWith("…")).toBe(true);
	});

	it("leaves a short fact untouched", () => {
		expect(normalizeMemoryText("prefers dark mode")).toBe("prefers dark mode");
	});
});

describe("buildMemoryDraft — consent-gated, bounded", () => {
	it("returns null for blank / whitespace text (no empty memory)", () => {
		expect(buildMemoryDraft("")).toBeNull();
		expect(buildMemoryDraft("   \n  ")).toBeNull();
	});

	it("builds a normalized draft with a timestamp", () => {
		const draft = buildMemoryDraft("  remembers  this  ", { now: "2026-01-01T00:00:00.000Z" });
		expect(draft).toEqual({ text: "remembers this", createdAt: "2026-01-01T00:00:00.000Z" });
	});

	it("carries a non-blank source as provenance only", () => {
		const draft = buildMemoryDraft("fact", { now: "t", source: "ent_conv_1" });
		expect(draft?.source).toBe("ent_conv_1");
	});

	it("drops a blank source", () => {
		const draft = buildMemoryDraft("fact", { now: "t", source: "  " });
		expect(draft && "source" in draft).toBe(false);
	});

	it("clamps an over-long fact (not a transcript)", () => {
		const draft = buildMemoryDraft("y".repeat(MEMORY_TEXT_MAX + 10), { now: "t" });
		expect(draft?.text.length).toBe(MEMORY_TEXT_MAX);
	});
});

describe("buildMemoryEdit — redaction", () => {
	it("returns null when the edit would blank the memory", () => {
		expect(buildMemoryEdit("   ")).toBeNull();
	});

	it("normalizes and stamps updatedAt", () => {
		expect(buildMemoryEdit("  new  text ", "t2")).toEqual({ text: "new text", updatedAt: "t2" });
	});
});

describe("memoriesFromEntities", () => {
	it("drops blank-text rows and sorts newest-first", () => {
		const rows = [
			{ id: "ent_a", properties: { text: "alpha", createdAt: "t1" } },
			{ id: "ent_c", properties: { text: "  ", createdAt: "t2" } },
			{ id: "ent_b", properties: { text: "beta", createdAt: "t3" } },
		];
		const items = memoriesFromEntities(rows);
		expect(items.map((m) => m.entityId)).toEqual(["ent_b", "ent_a"]);
		expect(items[0]?.text).toBe("beta");
	});

	it("tolerates a missing createdAt", () => {
		const items = memoriesFromEntities([{ id: "ent_a", properties: { text: "x" } }]);
		expect(items[0]?.createdAt).toBe("");
	});
});

describe("buildMemoryContextBlock — bounded + fail-soft", () => {
	const item = (id: string, text: string): MemoryItem => ({ entityId: id, text, createdAt: "t" });

	it("returns empty string for no memories (disabled / empty degrades to ungrounded)", () => {
		expect(buildMemoryContextBlock([])).toBe("");
	});

	it("lists facts under a header", () => {
		const block = buildMemoryContextBlock([item("a", "likes tea"), item("b", "lives in Berlin")]);
		expect(block).toContain("What you remember about the user");
		expect(block).toContain("- likes tea");
		expect(block).toContain("- lives in Berlin");
	});

	it("bounds to top-K", () => {
		const many = Array.from({ length: MEMORY_RECALL_TOP_K + 20 }, (_, i) =>
			item(`e${i}`, `fact ${i}`),
		);
		const block = buildMemoryContextBlock(many);
		const factLines = block.split("\n").filter((l) => l.startsWith("- "));
		expect(factLines.length).toBe(MEMORY_RECALL_TOP_K);
	});

	it("skips a blank item rather than throwing", () => {
		const block = buildMemoryContextBlock([item("a", "   "), item("b", "real")]);
		expect(block).toContain("- real");
		expect(block).not.toContain("-  ");
	});

	it("returns empty when every item is blank", () => {
		expect(buildMemoryContextBlock([item("a", "  "), item("b", "")])).toBe("");
	});
});

describe("withMemoryContext", () => {
	it("appends a non-empty block separated by a blank line", () => {
		expect(withMemoryContext("base", "block")).toBe("base\n\nblock");
	});

	it("leaves the instruction untouched for a blank block", () => {
		expect(withMemoryContext("base", "")).toBe("base");
	});

	it("yields the block alone for a blank base (no leading blank lines)", () => {
		expect(withMemoryContext("", "block")).toBe("block");
	});
});
