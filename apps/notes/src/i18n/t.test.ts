import { describe, expect, it, vi } from "vitest";
import { t, tCount } from "./t";

describe("t()", () => {
	it("returns the default-English string for a known key", () => {
		expect(t("notes.a11y.blocksSelected.one")).toBe("1 block selected");
	});

	it("interpolates {param} placeholders", () => {
		expect(t("notes.a11y.blocksSelected.other", { count: 3 })).toBe("3 blocks selected");
	});

	it("leaves unknown {param} as `{name}` literal", () => {
		expect(t("notes.a11y.blocksSelected.other")).toBe("{count} blocks selected");
	});

	it("returns a visible `[?key]` marker for missing keys", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(t("notes.missing.key")).toBe("[?notes.missing.key]");
		spy.mockRestore();
	});
});

describe("tCount()", () => {
	it("picks the .one form for 1", () => {
		expect(tCount("notes.a11y.blocksSelected", 1)).toBe("1 block selected");
	});

	it("picks the .other form for 2+", () => {
		expect(tCount("notes.a11y.blocksSelected", 5)).toBe("5 blocks selected");
	});

	it("picks the .other form for 0", () => {
		expect(tCount("notes.a11y.blocksSelected", 0)).toBe("0 blocks selected");
	});
});
