import { describe, expect, it } from "vitest";
import { applyClick, clearSelection, createSelection, isSelected } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("applyClick", () => {
	it("plain click replaces selection with the target", () => {
		let s = createSelection();
		s = applyClick(s, "b", { shiftKey: false, metaKey: false }, order);
		expect([...s.selectedIds]).toEqual(["b"]);
		expect(s.anchorId).toBe("b");

		s = applyClick(s, "d", { shiftKey: false, metaKey: false }, order);
		expect([...s.selectedIds]).toEqual(["d"]);
		expect(s.anchorId).toBe("d");
	});

	it("meta click toggles the target without disturbing the rest", () => {
		let s = createSelection();
		s = applyClick(s, "a", { shiftKey: false, metaKey: false }, order);
		s = applyClick(s, "c", { shiftKey: false, metaKey: true }, order);
		expect([...s.selectedIds].sort()).toEqual(["a", "c"]);

		s = applyClick(s, "c", { shiftKey: false, metaKey: true }, order);
		expect([...s.selectedIds]).toEqual(["a"]);
	});

	it("shift click extends from the anchor across the visible order", () => {
		let s = createSelection();
		s = applyClick(s, "b", { shiftKey: false, metaKey: false }, order);
		s = applyClick(s, "d", { shiftKey: true, metaKey: false }, order);
		expect([...s.selectedIds]).toEqual(["b", "c", "d"]);
		expect(s.anchorId).toBe("b");
	});

	it("shift click works in reverse direction", () => {
		let s = createSelection();
		s = applyClick(s, "d", { shiftKey: false, metaKey: false }, order);
		s = applyClick(s, "a", { shiftKey: true, metaKey: false }, order);
		expect([...s.selectedIds]).toEqual(["a", "b", "c", "d"]);
	});

	it("shift click without an anchor falls back to single", () => {
		let s = createSelection();
		s = applyClick(s, "c", { shiftKey: true, metaKey: false }, order);
		expect([...s.selectedIds]).toEqual(["c"]);
	});
});

describe("clearSelection", () => {
	it("returns an empty selection with no anchor", () => {
		const s = clearSelection();
		expect(s.selectedIds.size).toBe(0);
		expect(s.anchorId).toBe(null);
	});
});

describe("isSelected", () => {
	it("reads membership", () => {
		const s = applyClick(createSelection(), "b", { shiftKey: false, metaKey: false }, order);
		expect(isSelected(s, "b")).toBe(true);
		expect(isSelected(s, "a")).toBe(false);
	});
});
