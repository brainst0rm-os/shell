import { describe, expect, it } from "vitest";
import {
	CompositeKey,
	type CompositeState,
	compositeInit,
	compositeKey,
	compositeRoles,
} from "./composite-keyboard";
import { Orientation } from "./orientation";

// Hand-rolled deterministic LCG so the property tests are reproducible — no
// fast-check in the workspace, matching the existing `nav-history` precedent
// of in-file property generators.
function lcg(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function randomDisabled(rand: () => number, count: number): Set<number> {
	const disabled = new Set<number>();
	for (let i = 0; i < count; i++) {
		if (rand() < 0.25) disabled.add(i);
	}
	// Always leave at least one enabled so a "Next from x then Previous back"
	// invariant has a stable home; the all-disabled branch is its own test.
	if (disabled.size === count && count > 0) disabled.delete(0);
	return disabled;
}

function nextEnabledIdx(
	disabled: Set<number>,
	count: number,
	start: number,
	wrap: boolean,
): number {
	const limit = wrap ? count : count - start;
	for (let step = 0; step < limit; step++) {
		const i = wrap ? (start + step) % count : start + step;
		if (i >= count) return -1;
		if (!disabled.has(i)) return i;
	}
	return -1;
}

describe("compositeInit", () => {
	it("clamps activeIndex to the valid range", () => {
		expect(
			compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 9 }).activeIndex,
		).toBe(4);
		expect(
			compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: -3 }).activeIndex,
		).toBe(0);
		expect(compositeInit({ orientation: Orientation.Vertical, count: 0 }).activeIndex).toBe(-1);
	});

	it("defaults wrap = true and pageSize = 10", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 3 });
		expect(s.wrap).toBe(true);
		expect(s.pageSize).toBe(10);
	});

	it("Grid orientation requires columns; clamps non-positive to 1", () => {
		const s = compositeInit({ orientation: Orientation.Grid, count: 4, columns: 0 });
		expect(s.columns).toBe(1);
	});

	it("freezes the state object", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 3 });
		expect(Object.isFrozen(s)).toBe(true);
	});
});

describe("composite-keyboard property: Next ∘ Previous round-trip", () => {
	for (const orientation of [Orientation.Vertical, Orientation.Horizontal, Orientation.Grid]) {
		for (const wrap of [true, false]) {
			it(`returns to the original active index across orientations and wrap (${orientation}/wrap=${wrap})`, () => {
				const rand = lcg(0xb1e57e1 ^ Number(wrap) ^ orientation.length);
				for (let trial = 0; trial < 200; trial++) {
					const count = 1 + Math.floor(rand() * 50);
					const columns =
						orientation === Orientation.Grid ? 1 + Math.floor(rand() * Math.min(count, 8)) : 1;
					const disabled = randomDisabled(rand, count);
					if (disabled.size === count) continue;
					const start = Math.floor(rand() * count);
					if (disabled.has(start)) continue;
					const init: CompositeState = compositeInit({
						orientation,
						count,
						activeIndex: start,
						columns,
						wrap,
					});
					const after = compositeKey(init, CompositeKey.Next, { disabled });
					// Property: if `Next` actually moved off `start`, then
					// `Previous` returns to `start`. If `Next` was a no-op
					// (no-wrap at the trailing edge, or only `start` is
					// enabled), the round-trip claim doesn't apply — but
					// `after === init` must hold via reference equality.
					if (after === init) {
						// fall through — no movement to invert.
						continue;
					}
					const back = compositeKey(after, CompositeKey.Previous, { disabled });
					expect(back.activeIndex).toBe(start);
				}
			});
		}
	}
});

describe("composite-keyboard property: wrap visits every enabled index in 2*count Next steps", () => {
	it("Next visits every enabled index at least once when wrap = true", () => {
		const rand = lcg(0xc0ffee);
		for (let trial = 0; trial < 50; trial++) {
			const count = 1 + Math.floor(rand() * 50);
			const disabled = randomDisabled(rand, count);
			const enabledSet = new Set([...Array(count).keys()].filter((i) => !disabled.has(i)));
			if (enabledSet.size === 0) continue;
			let state = compositeInit({
				orientation: Orientation.Vertical,
				count,
				activeIndex: nextEnabledIdx(disabled, count, 0, true),
				wrap: true,
			});
			const visited = new Set<number>([state.activeIndex]);
			for (let step = 0; step < 2 * count; step++) {
				state = compositeKey(state, CompositeKey.Next, { disabled });
				visited.add(state.activeIndex);
			}
			for (const e of enabledSet) {
				expect(visited.has(e)).toBe(true);
			}
		}
	});
});

describe("composite-keyboard property: no-wrap sticks at the ends", () => {
	it("Next at the last enabled is a no-op; Previous at the first enabled is a no-op", () => {
		const rand = lcg(0xdeadbeef);
		for (let trial = 0; trial < 100; trial++) {
			const count = 1 + Math.floor(rand() * 50);
			const disabled = randomDisabled(rand, count);
			const enabled = [...Array(count).keys()].filter((i) => !disabled.has(i));
			if (enabled.length === 0) continue;
			const first = enabled[0] as number;
			const last = enabled[enabled.length - 1] as number;
			const atFirst = compositeInit({
				orientation: Orientation.Vertical,
				count,
				activeIndex: first,
				wrap: false,
			});
			const atLast = compositeInit({
				orientation: Orientation.Vertical,
				count,
				activeIndex: last,
				wrap: false,
			});
			expect(compositeKey(atFirst, CompositeKey.Previous, { disabled }).activeIndex).toBe(first);
			expect(compositeKey(atLast, CompositeKey.Next, { disabled }).activeIndex).toBe(last);
		}
	});
});

describe("composite-keyboard Home / End", () => {
	it("Home lands on the first enabled; End on the last enabled", () => {
		const disabled = new Set([0, 1, 4]);
		const s = compositeInit({
			orientation: Orientation.Vertical,
			count: 5,
			activeIndex: 2,
		});
		expect(compositeKey(s, CompositeKey.Home, { disabled }).activeIndex).toBe(2);
		expect(compositeKey(s, CompositeKey.End, { disabled }).activeIndex).toBe(3);
	});

	it("Home and End are no-ops when every item is disabled", () => {
		const disabled = new Set([0, 1, 2]);
		const s = compositeInit({
			orientation: Orientation.Vertical,
			count: 3,
			activeIndex: 0,
		});
		expect(compositeKey(s, CompositeKey.Home, { disabled })).toBe(s);
		expect(compositeKey(s, CompositeKey.End, { disabled })).toBe(s);
	});
});

describe("composite-keyboard Grid row moves", () => {
	it("NextRow moves activeIndex by columns; PreviousRow mirrors", () => {
		const s = compositeInit({
			orientation: Orientation.Grid,
			count: 12,
			columns: 4,
			activeIndex: 5,
		});
		expect(compositeKey(s, CompositeKey.NextRow).activeIndex).toBe(9);
		expect(compositeKey(s, CompositeKey.PreviousRow).activeIndex).toBe(1);
	});

	it("clamps at the last (possibly partial) row", () => {
		// 10 items in a 3-column grid → rows [0,1,2], [3,4,5], [6,7,8], [9].
		const s = compositeInit({
			orientation: Orientation.Grid,
			count: 10,
			columns: 3,
			activeIndex: 7,
		});
		// 7 + 3 = 10 ≥ count → no-op (no row below).
		expect(compositeKey(s, CompositeKey.NextRow).activeIndex).toBe(7);
		const s2 = compositeInit({
			orientation: Orientation.Grid,
			count: 10,
			columns: 3,
			activeIndex: 6,
		});
		// 6 + 3 = 9 < 10 → lands on 9.
		expect(compositeKey(s2, CompositeKey.NextRow).activeIndex).toBe(9);
	});

	it("PreviousRow at row 0 is a no-op", () => {
		const s = compositeInit({
			orientation: Orientation.Grid,
			count: 12,
			columns: 4,
			activeIndex: 2,
		});
		expect(compositeKey(s, CompositeKey.PreviousRow)).toBe(s);
	});

	it("row moves are no-ops outside Grid orientation", () => {
		const v = compositeInit({ orientation: Orientation.Vertical, count: 6, activeIndex: 2 });
		expect(compositeKey(v, CompositeKey.NextRow)).toBe(v);
		expect(compositeKey(v, CompositeKey.PreviousRow)).toBe(v);
	});

	it("skips a disabled candidate by searching forward within the same row, then back", () => {
		const disabled = new Set([5]);
		const s = compositeInit({
			orientation: Orientation.Grid,
			count: 9,
			columns: 3,
			activeIndex: 2,
		});
		// 2 → 5 candidate is disabled; same row is [3,4,5], search forward
		// within the row from index 6 — but 6 isn't in this row. Wait: row of
		// 5 is row 1 = [3,4,5]; forward-in-row from 5 lands at 5 only, then
		// backward yields 4 then 3. So expectation is 4.
		expect(compositeKey(s, CompositeKey.NextRow, { disabled }).activeIndex).toBe(4);
	});
});

describe("composite-keyboard Typeahead", () => {
	it("jumps to a valid enabled target", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 0 });
		expect(compositeKey(s, CompositeKey.Typeahead, { typeaheadIndex: 3 }).activeIndex).toBe(3);
	});

	it("is a no-op when target is disabled", () => {
		const disabled = new Set([3]);
		const s = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 0 });
		expect(compositeKey(s, CompositeKey.Typeahead, { typeaheadIndex: 3, disabled })).toBe(s);
	});

	it("is a no-op without a target", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 0 });
		expect(compositeKey(s, CompositeKey.Typeahead)).toBe(s);
	});

	it("rejects out-of-range targets", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 0 });
		expect(compositeKey(s, CompositeKey.Typeahead, { typeaheadIndex: -1 })).toBe(s);
		expect(compositeKey(s, CompositeKey.Typeahead, { typeaheadIndex: 5 })).toBe(s);
	});
});

describe("composite-keyboard PageDown / PageUp", () => {
	it("PageDown of 10 from 3 in a 25-list lands on 13; from 18 lands on 24", () => {
		const a = compositeInit({ orientation: Orientation.Vertical, count: 25, activeIndex: 3 });
		const b = compositeInit({ orientation: Orientation.Vertical, count: 25, activeIndex: 18 });
		expect(compositeKey(a, CompositeKey.PageDown).activeIndex).toBe(13);
		expect(compositeKey(b, CompositeKey.PageDown).activeIndex).toBe(24);
	});

	it("PageUp of 10 from 22 lands on 12; from 4 lands on 0", () => {
		const a = compositeInit({ orientation: Orientation.Vertical, count: 25, activeIndex: 22 });
		const b = compositeInit({ orientation: Orientation.Vertical, count: 25, activeIndex: 4 });
		expect(compositeKey(a, CompositeKey.PageUp).activeIndex).toBe(12);
		expect(compositeKey(b, CompositeKey.PageUp).activeIndex).toBe(0);
	});

	it("honours an explicit pageSize override on the ctx", () => {
		const s = compositeInit({
			orientation: Orientation.Vertical,
			count: 25,
			activeIndex: 0,
			pageSize: 10,
		});
		expect(compositeKey(s, CompositeKey.PageDown, { pageSize: 3 }).activeIndex).toBe(3);
	});

	it("never wraps — sticks at end (per spec, paging is bounded)", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 4 });
		expect(compositeKey(s, CompositeKey.PageDown).activeIndex).toBe(4);
		const t = compositeInit({ orientation: Orientation.Vertical, count: 5, activeIndex: 0 });
		expect(compositeKey(t, CompositeKey.PageUp).activeIndex).toBe(0);
	});

	it("falls back through disabled entries at the page-target", () => {
		const disabled = new Set([13]);
		const s = compositeInit({ orientation: Orientation.Vertical, count: 25, activeIndex: 3 });
		// Target 13 is disabled → search backward (12) before forward.
		expect(compositeKey(s, CompositeKey.PageDown, { disabled }).activeIndex).toBe(12);
	});

	it("PageDown never regresses past the active index when the forward span is fully disabled", () => {
		// Regression: an earlier `seekBackward(target, ..., false)` could land at
		// active or below it when every cell in (active, target] was disabled.
		const disabled = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
		const s = compositeInit({ orientation: Orientation.Vertical, count: 20, activeIndex: 5 });
		expect(compositeKey(s, CompositeKey.PageDown, { disabled }).activeIndex).toBe(5);
	});

	it("PageUp never advances past the active index when the backward span is fully disabled", () => {
		const disabled = new Set([0, 1, 2, 3, 4]);
		const s = compositeInit({ orientation: Orientation.Vertical, count: 20, activeIndex: 4 });
		expect(compositeKey(s, CompositeKey.PageUp, { disabled }).activeIndex).toBe(4);
	});
});

describe("composite-keyboard non-finite count guard", () => {
	it("compositeInit clamps NaN/Infinity count to 0 so downstream count===0 guards fire", () => {
		const a = compositeInit({ orientation: Orientation.Vertical, count: Number.NaN });
		expect(a.count).toBe(0);
		expect(a.activeIndex).toBe(-1);
		const b = compositeInit({ orientation: Orientation.Vertical, count: Number.POSITIVE_INFINITY });
		expect(b.count).toBe(0);
		const c = compositeInit({
			orientation: Orientation.Vertical,
			count: Number.NEGATIVE_INFINITY,
		});
		expect(c.count).toBe(0);
		expect(compositeKey(a, CompositeKey.Next)).toBe(a);
	});
});

describe("composite-keyboard Activate", () => {
	it("Activate is a no-op on state (intent only — host wires onActivate)", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 3, activeIndex: 1 });
		expect(compositeKey(s, CompositeKey.Activate)).toBe(s);
	});
});

describe("composite-keyboard empty / all-disabled edge cases", () => {
	it("count = 0 — every transition is a no-op", () => {
		const s = compositeInit({ orientation: Orientation.Vertical, count: 0 });
		for (const k of Object.values(CompositeKey)) {
			expect(compositeKey(s, k)).toBe(s);
		}
		expect(s.activeIndex).toBe(-1);
	});

	it("every index disabled — Next / Previous / Home / End all no-op", () => {
		const disabled = new Set([0, 1, 2]);
		const s = compositeInit({ orientation: Orientation.Vertical, count: 3, activeIndex: 0 });
		expect(compositeKey(s, CompositeKey.Next, { disabled })).toBe(s);
		expect(compositeKey(s, CompositeKey.Previous, { disabled })).toBe(s);
		expect(compositeKey(s, CompositeKey.Home, { disabled })).toBe(s);
		expect(compositeKey(s, CompositeKey.End, { disabled })).toBe(s);
	});
});

describe("compositeRoles", () => {
	it("defaults a flat list to listbox / option", () => {
		expect(compositeRoles(Orientation.Vertical)).toEqual({
			containerRole: "listbox",
			itemRole: "option",
		});
		expect(compositeRoles(Orientation.Horizontal)).toEqual({
			containerRole: "listbox",
			itemRole: "option",
		});
	});

	it("defaults a 2-D grid to grid / gridcell", () => {
		expect(compositeRoles(Orientation.Grid)).toEqual({
			containerRole: "grid",
			itemRole: "gridcell",
		});
	});

	it("honours explicit overrides (e.g. tablist / tab)", () => {
		expect(compositeRoles(Orientation.Horizontal, "tablist", "tab")).toEqual({
			containerRole: "tablist",
			itemRole: "tab",
		});
	});

	it("overrides are independent — container without item, and vice versa", () => {
		expect(compositeRoles(Orientation.Grid, undefined, "row")).toEqual({
			containerRole: "grid",
			itemRole: "row",
		});
	});

	it("a toolbar has no item role (its items keep their native role)", () => {
		expect(compositeRoles(Orientation.Horizontal, "toolbar")).toEqual({
			containerRole: "toolbar",
			itemRole: undefined,
		});
		// ...unless the caller explicitly sets one.
		expect(compositeRoles(Orientation.Horizontal, "toolbar", "menuitem")).toEqual({
			containerRole: "toolbar",
			itemRole: "menuitem",
		});
	});
});
