import { describe, expect, it } from "vitest";
import type { ColumnSpec } from "../types/list-view";
import { computeColumnReorder } from "./grid-view";

const COL = (propertyId: string, width = 160): ColumnSpec => ({
	propertyId,
	width,
	visible: true,
});

describe("computeColumnReorder — dnd-kit onDragEnd reorder", () => {
	const baseline: ColumnSpec[] = [COL("status"), COL("priority"), COL("due"), COL("owner")];

	it("moves a column forward (status → due)", () => {
		const next = computeColumnReorder(baseline, "status", "due");
		expect(next?.map((c) => c.propertyId)).toEqual(["priority", "due", "status", "owner"]);
	});

	it("moves a column backward (owner → status)", () => {
		const next = computeColumnReorder(baseline, "owner", "status");
		expect(next?.map((c) => c.propertyId)).toEqual(["owner", "status", "priority", "due"]);
	});

	it("returns null on a same-column drop (no-op)", () => {
		expect(computeColumnReorder(baseline, "priority", "priority")).toBeNull();
	});

	it("returns null when either id is missing (no spurious reorder)", () => {
		expect(computeColumnReorder(baseline, "ghost", "priority")).toBeNull();
		expect(computeColumnReorder(baseline, "status", "ghost")).toBeNull();
	});

	it("preserves the other column fields (width, visible)", () => {
		const wide: ColumnSpec[] = [
			COL("status", 240),
			{ propertyId: "due", width: 100, visible: false },
			COL("owner"),
		];
		const next = computeColumnReorder(wide, "status", "owner");
		expect(next).toEqual([
			{ propertyId: "due", width: 100, visible: false },
			COL("owner"),
			COL("status", 240),
		]);
	});

	it("does not mutate the input array (caller relies on a fresh array)", () => {
		const frozen = Object.freeze([...baseline]);
		const next = computeColumnReorder(frozen, "status", "due");
		expect(next).not.toBe(frozen);
		// Reference equality on shared column objects is fine — only the
		// containing array is required to be fresh.
		expect(next?.[2]).toBe(baseline[0]);
	});
});
