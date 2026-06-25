/**
 * Row drag-reorder core. `applyManualOrder` is pure, so the reordering
 * logic is proven here (the grid drop wiring is DOM-drag, not unit-
 * testable). Locks: listed ids follow the order, unlisted keep their
 * relative position appended, stable/no-op on identical order.
 */

import { describe, expect, it } from "vitest";
import { applyManualOrder } from "../src/logic/compile-view";
import type { EntityRow } from "../src/logic/in-memory-entities";

const row = (id: string): EntityRow => ({
	id,
	type: "x/T/v1",
	properties: { name: id },
	createdAt: 0,
	updatedAt: 0,
	deletedAt: null,
});

describe("applyManualOrder", () => {
	it("reorders rows to match the id order", () => {
		const out = applyManualOrder([row("a"), row("b"), row("c")], ["c", "a", "b"]);
		expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
	});

	it("ids not in the order keep their relative position, appended after", () => {
		const out = applyManualOrder([row("a"), row("b"), row("c"), row("d")], ["c", "a"]);
		expect(out.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
	});

	it("is stable / a no-op when the order already matches", () => {
		const rows = [row("a"), row("b"), row("c")];
		expect(applyManualOrder(rows, ["a", "b", "c"]).map((r) => r.id)).toEqual(["a", "b", "c"]);
	});

	it("tolerates order ids that aren't in the rows", () => {
		const out = applyManualOrder([row("a"), row("b")], ["ghost", "b", "a"]);
		expect(out.map((r) => r.id)).toEqual(["b", "a"]);
	});
});
