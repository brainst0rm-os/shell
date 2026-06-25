import { describe, expect, it } from "vitest";
import { applyReorder } from "./list-dnd";

describe("applyReorder — drag/drop position math", () => {
	const ids = ["a", "b", "c", "d", "e"];

	it("moves dragged before targetId in the same list", () => {
		expect(applyReorder(ids, "d", "b")).toEqual(["a", "d", "b", "c", "e"]);
	});

	it("moves dragged to the end when targetId is null", () => {
		expect(applyReorder(ids, "a", null)).toEqual(["b", "c", "d", "e", "a"]);
	});

	it("returns a copy unchanged when dragged === target", () => {
		expect(applyReorder(ids, "c", "c")).toEqual(ids);
	});

	it("moves a row up by one position", () => {
		expect(applyReorder(ids, "c", "b")).toEqual(["a", "c", "b", "d", "e"]);
	});

	it("moves a row down by one position by passing the row AFTER its new neighbour", () => {
		expect(applyReorder(ids, "b", "d")).toEqual(["a", "c", "b", "d", "e"]);
	});

	it("is robust to a missing draggedId — returns the input list intact", () => {
		expect(applyReorder(ids, "missing", "b")).toEqual(ids);
	});

	it("is robust to a missing targetId — returns the input list intact", () => {
		expect(applyReorder(ids, "a", "missing")).toEqual(ids);
	});

	it("preserves identity (doesn't return the same reference) so callers can pass the result on without aliasing", () => {
		const out = applyReorder(ids, "a", "b");
		expect(out).not.toBe(ids);
	});
});
