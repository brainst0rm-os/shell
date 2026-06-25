import { describe, expect, test } from "vitest";
import type { List } from "../types/list";
import { type ListView, ListViewKind } from "../types/list-view";
import {
	appendViewToList,
	buildViewTabs,
	insertViewAfter,
	moveViewByStep,
	nextActiveAfterRemoval,
	orderViewsForStrip,
	removeView,
	reorderViews,
} from "./view-strip";

const view = (id: string, listId: string, kind = ListViewKind.Grid): ListView => ({
	id,
	listId,
	name: id,
	icon: null,
	kind,
	filters: null,
	sorts: [],
	groupBy: null,
	coverProperty: null,
	cardSubtitleProperty: null,
	columns: [],
	defaultTypeUrl: null,
	defaultTemplate: null,
	pageSize: 50,
	layoutOptions: { rowHeight: "comfortable", showRowNumbers: false, pinFirstColumn: true },
});

const list = (id: string, views: string[], defaultViewId: string | null): List => ({
	id,
	name: id,
	icon: null,
	description: "",
	source: null,
	members: { include: [], exclude: [] },
	views,
	defaultViewId,
	defaultTemplate: null,
	createdAt: 0,
	updatedAt: 0,
});

describe("orderViewsForStrip", () => {
	test("honours List.views order over pool order", () => {
		const pool = [view("c", "L"), view("a", "L"), view("b", "L")];
		const ordered = orderViewsForStrip(pool, "L", ["a", "b", "c"]);
		expect(ordered.map((v) => v.id)).toEqual(["a", "b", "c"]);
	});

	test("appends pool views missing from the order array", () => {
		const pool = [view("a", "L"), view("b", "L"), view("c", "L")];
		const ordered = orderViewsForStrip(pool, "L", ["b"]);
		expect(ordered.map((v) => v.id)).toEqual(["b", "a", "c"]);
	});

	test("drops order ids that no longer resolve to a live view", () => {
		const pool = [view("a", "L")];
		const ordered = orderViewsForStrip(pool, "L", ["a", "gone"]);
		expect(ordered.map((v) => v.id)).toEqual(["a"]);
	});

	test("scopes to the requested list, ignoring other lists' views", () => {
		const pool = [view("a", "L"), view("x", "OTHER"), view("b", "L")];
		const ordered = orderViewsForStrip(pool, "L", ["a", "b"]);
		expect(ordered.map((v) => v.id)).toEqual(["a", "b"]);
	});

	test("dedupes a duplicated id in the order array", () => {
		const pool = [view("a", "L"), view("b", "L")];
		const ordered = orderViewsForStrip(pool, "L", ["a", "a", "b"]);
		expect(ordered.map((v) => v.id)).toEqual(["a", "b"]);
	});
});

describe("buildViewTabs", () => {
	test("flags the active view and carries display fields", () => {
		const pool = [view("a", "L", ListViewKind.Grid), view("b", "L", ListViewKind.Board)];
		const tabs = buildViewTabs(pool, "L", ["a", "b"], "b");
		expect(tabs).toEqual([
			{ id: "a", name: "a", kind: ListViewKind.Grid, icon: null, active: false },
			{ id: "b", name: "b", kind: ListViewKind.Board, icon: null, active: true },
		]);
	});

	test("no tab is active when the active id is null", () => {
		const pool = [view("a", "L")];
		expect(buildViewTabs(pool, "L", ["a"], null)[0]?.active).toBe(false);
	});
});

describe("reorderViews", () => {
	test("moves a tab before another", () => {
		expect(reorderViews(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
	});

	test("a null target drops the moved id at the end", () => {
		expect(reorderViews(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
	});

	test("moving onto itself is a no-op (same reference)", () => {
		const order = ["a", "b"];
		expect(reorderViews(order, "a", "a")).toBe(order);
	});

	test("an absent moving id is a no-op", () => {
		const order = ["a", "b"];
		expect(reorderViews(order, "z", "a")).toBe(order);
	});

	test("an absent target is a no-op", () => {
		const order = ["a", "b"];
		expect(reorderViews(order, "a", "z")).toBe(order);
	});

	test("a move that changes nothing returns the same reference", () => {
		const order = ["a", "b", "c"];
		expect(reorderViews(order, "a", "b")).toBe(order);
		expect(reorderViews(order, "c", null)).toBe(order);
	});
});

describe("moveViewByStep", () => {
	test("steps a tab right by one slot", () => {
		expect(moveViewByStep(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
	});

	test("steps a tab left by one slot", () => {
		expect(moveViewByStep(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
	});

	test("clamps at the right edge (same reference)", () => {
		const order = ["a", "b", "c"];
		expect(moveViewByStep(order, "c", 1)).toBe(order);
	});

	test("clamps at the left edge (same reference)", () => {
		const order = ["a", "b", "c"];
		expect(moveViewByStep(order, "a", -1)).toBe(order);
	});

	test("an absent moving id is a no-op (same reference)", () => {
		const order = ["a", "b"];
		expect(moveViewByStep(order, "z", 1)).toBe(order);
	});

	test("a right step then a left step round-trips", () => {
		const stepped = moveViewByStep(["a", "b", "c"], "b", 1);
		expect(moveViewByStep(stepped, "b", -1)).toEqual(["a", "b", "c"]);
	});
});

describe("nextActiveAfterRemoval", () => {
	test("falls to the next neighbour", () => {
		expect(nextActiveAfterRemoval(["a", "b", "c"], "b", "b")).toBe("c");
	});

	test("falls to the previous neighbour when removing the last tab", () => {
		expect(nextActiveAfterRemoval(["a", "b", "c"], "c", "c")).toBe("b");
	});

	test("returns null when the only tab is removed", () => {
		expect(nextActiveAfterRemoval(["a"], "a", "a")).toBeNull();
	});

	test("preserves the active view when a different tab is removed", () => {
		expect(nextActiveAfterRemoval(["a", "b", "c"], "a", "c")).toBe("c");
	});

	test("returns null when the removed id is unknown and nothing active", () => {
		expect(nextActiveAfterRemoval(["a", "b"], "z", "z")).toBeNull();
	});
});

describe("removeView", () => {
	test("prunes the pool, the order, and computes the next active tab", () => {
		const pool = [view("a", "L"), view("b", "L"), view("c", "L")];
		const result = removeView(list("L", ["a", "b", "c"], "a"), pool, "b", "b");
		expect(result.views.map((v) => v.id)).toEqual(["a", "c"]);
		expect(result.list.views).toEqual(["a", "c"]);
		expect(result.nextActiveViewId).toBe("c");
	});

	test("re-points defaultViewId when the default view is removed", () => {
		const pool = [view("a", "L"), view("b", "L")];
		const result = removeView(list("L", ["a", "b"], "a"), pool, "a", "a");
		expect(result.list.defaultViewId).toBe("b");
		expect(result.nextActiveViewId).toBe("b");
	});

	test("leaves defaultViewId untouched when another view is removed", () => {
		const pool = [view("a", "L"), view("b", "L")];
		const result = removeView(list("L", ["a", "b"], "a"), pool, "b", "a");
		expect(result.list.defaultViewId).toBe("a");
		expect(result.nextActiveViewId).toBe("a");
	});

	test("refuses to remove the last view (no-op)", () => {
		const inputList = list("L", ["a"], "a");
		const pool = [view("a", "L")];
		const result = removeView(inputList, pool, "a", "a");
		expect(result.list).toBe(inputList);
		expect(result.views).toBe(pool);
		expect(result.nextActiveViewId).toBe("a");
	});

	test("refuses an unknown view id (no-op)", () => {
		const inputList = list("L", ["a", "b"], "a");
		const pool = [view("a", "L"), view("b", "L")];
		const result = removeView(inputList, pool, "z", "a");
		expect(result.list).toBe(inputList);
	});
});

describe("appendViewToList", () => {
	test("appends a new view id to the order", () => {
		expect(appendViewToList(list("L", ["a"], "a"), "b").views).toEqual(["a", "b"]);
	});

	test("is idempotent for an id already present", () => {
		const inputList = list("L", ["a"], "a");
		expect(appendViewToList(inputList, "a")).toBe(inputList);
	});
});

describe("insertViewAfter", () => {
	test("splices the new id immediately after the reference id", () => {
		expect(insertViewAfter(list("L", ["a", "b", "c"], "a"), "x", "a").views).toEqual([
			"a",
			"x",
			"b",
			"c",
		]);
	});

	test("places after the last id (== append) when the reference is last", () => {
		expect(insertViewAfter(list("L", ["a", "b"], "a"), "x", "b").views).toEqual(["a", "b", "x"]);
	});

	test("appends when the reference id is null", () => {
		expect(insertViewAfter(list("L", ["a", "b"], "a"), "x", null).views).toEqual(["a", "b", "x"]);
	});

	test("appends when the reference id is not in the order", () => {
		expect(insertViewAfter(list("L", ["a", "b"], "a"), "x", "gone").views).toEqual(["a", "b", "x"]);
	});

	test("is idempotent for an id already present (same reference)", () => {
		const inputList = list("L", ["a", "b"], "a");
		expect(insertViewAfter(inputList, "a", "b")).toBe(inputList);
	});

	test("bumps updatedAt on a real insert", () => {
		const inputList = list("L", ["a"], "a");
		expect(insertViewAfter(inputList, "x", "a").updatedAt).toBeGreaterThan(inputList.updatedAt);
	});
});
