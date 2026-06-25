import { describe, expect, it } from "vitest";
import {
	EMPTY_SELECTION,
	SelectionModifier,
	type SelectionState,
	isSelected,
	modifierFromEvent,
	selectionReducer,
	selectionSize,
} from "./selection";

const ORDER = ["a", "b", "c", "d", "e"] as const;

function click(state: SelectionState, id: string, modifier: SelectionModifier): SelectionState {
	return selectionReducer(state, { kind: "click", id, modifier, order: ORDER });
}

describe("selectionReducer", () => {
	it("plain click replaces selection and sets anchor", () => {
		const after = click(EMPTY_SELECTION, "b", SelectionModifier.None);
		expect(after.anchorId).toBe("b");
		expect(Array.from(after.selected)).toEqual(["b"]);
	});

	it("Mod-click toggles membership and updates anchor", () => {
		let state: SelectionState = EMPTY_SELECTION;
		state = click(state, "b", SelectionModifier.None);
		state = click(state, "d", SelectionModifier.Toggle);
		expect(Array.from(state.selected).sort()).toEqual(["b", "d"]);
		expect(state.anchorId).toBe("d");

		state = click(state, "b", SelectionModifier.Toggle);
		expect(Array.from(state.selected)).toEqual(["d"]);
	});

	it("Shift-click selects an inclusive range from anchor to clicked id", () => {
		let state: SelectionState = click(EMPTY_SELECTION, "b", SelectionModifier.None);
		state = click(state, "d", SelectionModifier.Range);
		expect(Array.from(state.selected).sort()).toEqual(["b", "c", "d"]);
		expect(state.anchorId).toBe("b");
	});

	it("Shift-click in reverse order still picks the right range", () => {
		let state: SelectionState = click(EMPTY_SELECTION, "d", SelectionModifier.None);
		state = click(state, "a", SelectionModifier.Range);
		expect(Array.from(state.selected).sort()).toEqual(["a", "b", "c", "d"]);
		expect(state.anchorId).toBe("d");
	});

	it("Shift-click without an anchor anchors on the clicked id", () => {
		const state = click(EMPTY_SELECTION, "c", SelectionModifier.Range);
		expect(Array.from(state.selected)).toEqual(["c"]);
		expect(state.anchorId).toBe("c");
	});

	it("clear empties selection", () => {
		const state = selectionReducer(click(EMPTY_SELECTION, "b", SelectionModifier.None), {
			kind: "clear",
		});
		expect(state).toBe(EMPTY_SELECTION);
	});

	it("selectAll picks the full provided order, anchor = first", () => {
		const state = selectionReducer(EMPTY_SELECTION, { kind: "selectAll", order: ORDER });
		expect(Array.from(state.selected).sort()).toEqual(["a", "b", "c", "d", "e"]);
		expect(state.anchorId).toBe("a");
	});

	it("set overrides selection + anchor for keyboard nav", () => {
		const state = selectionReducer(EMPTY_SELECTION, {
			kind: "set",
			ids: ["b", "c"],
			anchorId: "c",
		});
		expect(Array.from(state.selected).sort()).toEqual(["b", "c"]);
		expect(state.anchorId).toBe("c");
	});

	it("click on an id not present in the current order is a no-op", () => {
		const state = click(EMPTY_SELECTION, "zzz", SelectionModifier.None);
		expect(state).toBe(EMPTY_SELECTION);
	});

	it("helper selectors", () => {
		const state = selectionReducer(click(EMPTY_SELECTION, "b", SelectionModifier.None), {
			kind: "click",
			id: "d",
			modifier: SelectionModifier.Range,
			order: ORDER,
		});
		expect(isSelected(state, "c")).toBe(true);
		expect(isSelected(state, "a")).toBe(false);
		expect(selectionSize(state)).toBe(3);
	});

	it("modifierFromEvent picks range > toggle > none", () => {
		expect(modifierFromEvent({ shift: true, mod: false })).toBe(SelectionModifier.Range);
		expect(modifierFromEvent({ shift: false, mod: true })).toBe(SelectionModifier.Toggle);
		expect(modifierFromEvent({ shift: false, mod: false })).toBe(SelectionModifier.None);
		expect(modifierFromEvent({ shift: true, mod: true })).toBe(SelectionModifier.Range);
	});
});

describe("selectionReducer — property: random sequences keep selection a subset of order", () => {
	it("never selects an id absent from the input order", () => {
		const rng = mulberry32(0xc0ffee);
		let state: SelectionState = EMPTY_SELECTION;
		for (let i = 0; i < 200; i++) {
			const id = ORDER[Math.floor(rng() * ORDER.length)] as string;
			const mods = [SelectionModifier.None, SelectionModifier.Toggle, SelectionModifier.Range];
			const mod = mods[Math.floor(rng() * mods.length)] as SelectionModifier;
			state = click(state, id, mod);
			for (const selectedId of state.selected) {
				expect(ORDER).toContain(selectedId);
			}
		}
	});
});

function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
