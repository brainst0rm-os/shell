import { describe, expect, it } from "vitest";
import { AggregationKind, AggregationUnit } from "./aggregations";
import type { EntityRow } from "./in-memory-entities";
import {
	columnRollupToSpec,
	computeRollup,
	entitiesById,
	linkedEntityIds,
	parseAggregationKind,
} from "./rollup";

function row(
	id: string,
	properties: Record<string, unknown>,
	deletedAt: number | null = null,
): EntityRow {
	return { id, type: "x", properties, createdAt: 0, updatedAt: 0, deletedAt };
}

describe("linkedEntityIds", () => {
	it("reads a scalar single-relation id", () => {
		expect(linkedEntityIds("e_1")).toEqual(["e_1"]);
	});

	it("returns [] for an empty / null / non-relation value", () => {
		expect(linkedEntityIds("")).toEqual([]);
		expect(linkedEntityIds(null)).toEqual([]);
		expect(linkedEntityIds(42)).toEqual([]);
		expect(linkedEntityIds({ value: "e_1" })).toEqual([]);
	});

	it("reads a LabeledValue[] multi-relation envelope", () => {
		expect(linkedEntityIds([{ value: "e_1" }, { value: "e_2" }])).toEqual(["e_1", "e_2"]);
	});

	it("reads a bare string[] and drops blanks / non-strings", () => {
		expect(linkedEntityIds(["e_1", "", "e_2", { value: "" }, 7, { value: 9 }])).toEqual([
			"e_1",
			"e_2",
		]);
	});
});

describe("entitiesById", () => {
	it("indexes live rows and excludes soft-deleted ones", () => {
		const map = entitiesById([row("a", {}), row("b", {}, 123)]);
		expect(map.has("a")).toBe(true);
		expect(map.has("b")).toBe(false);
	});
});

describe("computeRollup", () => {
	const deliverables = [
		row("d_1", { fee: 1000 }),
		row("d_2", { fee: 2500 }),
		row("d_3", { fee: 500 }),
	];
	const byId = entitiesById(deliverables);

	it("sums a target property across a multi relation (total fee across deliverables)", () => {
		const engagement = row("eng_1", {
			deliverables: [{ value: "d_1" }, { value: "d_2" }, { value: "d_3" }],
		});
		const result = computeRollup(
			engagement,
			{ relationKey: "deliverables", targetPropertyKey: "fee", aggregation: AggregationKind.Sum },
			byId,
		);
		expect(result.value).toBe(4000);
		expect(result.unit).toBe(AggregationUnit.Number);
	});

	it("averages across the linked set", () => {
		const engagement = row("eng_1", { deliverables: [{ value: "d_1" }, { value: "d_2" }] });
		const result = computeRollup(
			engagement,
			{ relationKey: "deliverables", targetPropertyKey: "fee", aggregation: AggregationKind.Average },
			byId,
		);
		expect(result.value).toBe(1750);
	});

	it("resolves a scalar single relation", () => {
		const engagement = row("eng_1", { primary: "d_2" });
		const result = computeRollup(
			engagement,
			{ relationKey: "primary", targetPropertyKey: "fee", aggregation: AggregationKind.Sum },
			byId,
		);
		expect(result.value).toBe(2500);
	});

	it("skips links with no matching entity (deleted / dangling target)", () => {
		const engagement = row("eng_1", {
			deliverables: [{ value: "d_1" }, { value: "ghost" }, { value: "d_3" }],
		});
		const result = computeRollup(
			engagement,
			{ relationKey: "deliverables", targetPropertyKey: "fee", aggregation: AggregationKind.Sum },
			byId,
		);
		expect(result.value).toBe(1500); // d_1 + d_3, ghost dropped
	});

	it("counts the related rows that carry a value", () => {
		const engagement = row("eng_1", {
			deliverables: [{ value: "d_1" }, { value: "d_2" }, { value: "d_3" }],
		});
		const result = computeRollup(
			engagement,
			{
				relationKey: "deliverables",
				targetPropertyKey: "fee",
				aggregation: AggregationKind.CountValues,
			},
			byId,
		);
		expect(result.value).toBe(3);
		expect(result.unit).toBe(AggregationUnit.Count);
	});

	it("returns the empty-set result when the relation is unset", () => {
		const engagement = row("eng_1", {});
		const result = computeRollup(
			engagement,
			{ relationKey: "deliverables", targetPropertyKey: "fee", aggregation: AggregationKind.Sum },
			byId,
		);
		expect(result.value).toBeNull(); // Sum over no values
	});
});

describe("parseAggregationKind", () => {
	it("passes through a known aggregation value", () => {
		expect(parseAggregationKind("sum")).toBe(AggregationKind.Sum);
		expect(parseAggregationKind("average")).toBe(AggregationKind.Average);
	});

	it("falls back to CountValues for an unknown / future value", () => {
		expect(parseAggregationKind("bogus")).toBe(AggregationKind.CountValues);
		expect(parseAggregationKind("")).toBe(AggregationKind.CountValues);
	});
});

describe("columnRollupToSpec", () => {
	it("lifts a persisted ColumnRollup (string aggregation) into a RollupSpec", () => {
		expect(
			columnRollupToSpec({
				relationKey: "deliverables",
				targetPropertyKey: "fee",
				aggregation: "sum",
				name: "Sum of Fee",
			}),
		).toEqual({
			relationKey: "deliverables",
			targetPropertyKey: "fee",
			aggregation: AggregationKind.Sum,
		});
	});

	it("degrades an unknown stored aggregation to a count", () => {
		expect(
			columnRollupToSpec({
				relationKey: "r",
				targetPropertyKey: "t",
				aggregation: "not-a-kind",
				name: "X",
			}).aggregation,
		).toBe(AggregationKind.CountValues);
	});
});
