import { describe, expect, it } from "vitest";
import { indentGuideDepths } from "./indent-guides";

describe("indentGuideDepths (tabWidth 2)", () => {
	it("one guide per tabWidth columns of leading space", () => {
		expect(indentGuideDepths("a\n  b\n    c")).toEqual([0, 1, 2]);
	});

	it("expands tabs to the tab width", () => {
		expect(indentGuideDepths("a\n\tb\n\t\tc")).toEqual([0, 1, 2]);
	});

	it("a blank line takes the min of its non-blank neighbours", () => {
		// outer(0) / inner(2) / blank / inner(2) → blank runs at depth 2.
		expect(indentGuideDepths("a\n    b\n\n    c")).toEqual([0, 2, 2, 2]);
	});

	it("a blank line between different depths takes the smaller", () => {
		expect(indentGuideDepths("    a\n\nb")).toEqual([2, 0, 0]);
	});

	it("empty content → single zero-depth line", () => {
		expect(indentGuideDepths("")).toEqual([0]);
	});
});
