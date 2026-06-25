import { describe, expect, it } from "vitest";
import { orderedSelection } from "./bulk";

describe("orderedSelection", () => {
	const visible = ["a", "b", "c", "d"];

	it("returns selected ids in visible order, not set order", () => {
		const selected = new Set(["d", "a"]);
		expect(orderedSelection(selected, visible)).toEqual(["a", "d"]);
	});

	it("drops ids that aren't visible", () => {
		const selected = new Set(["b", "ghost"]);
		expect(orderedSelection(selected, visible)).toEqual(["b"]);
	});

	it("is empty for an empty selection", () => {
		expect(orderedSelection(new Set(), visible)).toEqual([]);
	});
});
