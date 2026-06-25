import { describe, expect, it } from "vitest";
import {
	EMPTY_TASK_SELECTION,
	SelectionModifier,
	applyTaskClick,
	modifierFromEvent,
	pruneTaskSelection,
	selectAllTasks,
	taskSelectionSize,
} from "./task-selection";

const ORDER = ["a", "b", "c", "d", "e"];

describe("applyTaskClick", () => {
	it("toggles a single id in and out, tracking the anchor", () => {
		const one = applyTaskClick(EMPTY_TASK_SELECTION, "b", SelectionModifier.Toggle, ORDER);
		expect([...one.selected]).toEqual(["b"]);
		expect(one.anchorId).toBe("b");

		const two = applyTaskClick(one, "d", SelectionModifier.Toggle, ORDER);
		expect([...two.selected].sort()).toEqual(["b", "d"]);

		const back = applyTaskClick(two, "b", SelectionModifier.Toggle, ORDER);
		expect([...back.selected]).toEqual(["d"]);
	});

	it("selects an inclusive range from the anchor, in either direction", () => {
		const anchored = applyTaskClick(EMPTY_TASK_SELECTION, "d", SelectionModifier.Toggle, ORDER);
		const range = applyTaskClick(anchored, "b", SelectionModifier.Range, ORDER);
		expect([...range.selected].sort()).toEqual(["b", "c", "d"]);
		// The anchor is preserved so a follow-up Shift-click re-pivots from it.
		expect(range.anchorId).toBe("d");
	});

	it("falls back to selecting just the clicked id when there is no anchor", () => {
		const range = applyTaskClick(EMPTY_TASK_SELECTION, "c", SelectionModifier.Range, ORDER);
		expect([...range.selected]).toEqual(["c"]);
		expect(range.anchorId).toBe("c");
	});

	it("ignores a click on an id outside the visible order", () => {
		const next = applyTaskClick(EMPTY_TASK_SELECTION, "z", SelectionModifier.Toggle, ORDER);
		expect(next).toBe(EMPTY_TASK_SELECTION);
	});
});

describe("selectAllTasks", () => {
	it("selects every visible id with the first as anchor", () => {
		const all = selectAllTasks(ORDER);
		expect([...all.selected]).toEqual(ORDER);
		expect(all.anchorId).toBe("a");
	});

	it("is empty for an empty order", () => {
		expect(taskSelectionSize(selectAllTasks([]))).toBe(0);
	});
});

describe("pruneTaskSelection", () => {
	it("drops ids that left the visible order and resets a stale anchor", () => {
		const selected = applyTaskClick(
			applyTaskClick(EMPTY_TASK_SELECTION, "b", SelectionModifier.Toggle, ORDER),
			"d",
			SelectionModifier.Toggle,
			ORDER,
		);
		const pruned = pruneTaskSelection(selected, ["a", "b", "c"]);
		expect([...pruned.selected]).toEqual(["b"]);
		expect(pruned.anchorId).toBe(null);
	});

	it("returns the same reference when nothing changed (skip-render fast path)", () => {
		const selected = applyTaskClick(EMPTY_TASK_SELECTION, "b", SelectionModifier.Toggle, ORDER);
		expect(pruneTaskSelection(selected, ORDER)).toBe(selected);
	});
});

describe("modifierFromEvent", () => {
	it("maps shift → Range, mod → Toggle, neither → None", () => {
		expect(modifierFromEvent({ shift: true, mod: false })).toBe(SelectionModifier.Range);
		expect(modifierFromEvent({ shift: false, mod: true })).toBe(SelectionModifier.Toggle);
		expect(modifierFromEvent({ shift: false, mod: false })).toBe(SelectionModifier.None);
	});
});
