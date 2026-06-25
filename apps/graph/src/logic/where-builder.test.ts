/**
 * 9.13.9 subject `where` builder — round-trip + value-coercion + the
 * not-flat-editable guard. The builder must never silently corrupt a
 * predicate richer than its flat editor; these pin that contract.
 */

import { describe, expect, it } from "vitest";
import type { PropertyPredicate } from "../types/predicate";
import {
	WhereOp,
	emptyWhereRow,
	isUnaryOp,
	predicateToRows,
	rowsToPredicate,
} from "./where-builder";

describe("rowsToPredicate", () => {
	it("drops property-less rows and yields null when nothing usable", () => {
		expect(rowsToPredicate([emptyWhereRow()])).toBeNull();
		expect(rowsToPredicate([{ property: "  ", op: WhereOp.Eq, value: "x" }])).toBeNull();
	});

	it("returns a bare leaf for a single row", () => {
		expect(rowsToPredicate([{ property: "status", op: WhereOp.Eq, value: "done" }])).toEqual({
			$eq: { status: "done" },
		});
	});

	it("ANDs multiple rows", () => {
		expect(
			rowsToPredicate([
				{ property: "status", op: WhereOp.Eq, value: "done" },
				{ property: "priority", op: WhereOp.Gt, value: "2" },
			]),
		).toEqual({ $and: [{ $eq: { status: "done" } }, { $gt: { priority: 2 } }] });
	});

	it("coerces numeric and boolean values, keeps strings", () => {
		expect(rowsToPredicate([{ property: "n", op: WhereOp.Gte, value: "10" }])).toEqual({
			$gte: { n: 10 },
		});
		expect(rowsToPredicate([{ property: "b", op: WhereOp.Eq, value: "true" }])).toEqual({
			$eq: { b: true },
		});
		expect(rowsToPredicate([{ property: "s", op: WhereOp.Eq, value: "12abc" }])).toEqual({
			$eq: { s: "12abc" },
		});
	});

	it("emits the unary shape (value = true) for $exists / $empty", () => {
		expect(rowsToPredicate([{ property: "tag", op: WhereOp.Exists, value: "" }])).toEqual({
			$exists: { tag: true },
		});
		expect(isUnaryOp(WhereOp.Empty)).toBe(true);
		expect(isUnaryOp(WhereOp.Eq)).toBe(false);
	});
});

describe("predicateToRows", () => {
	it("null → one empty editable starter row", () => {
		expect(predicateToRows(null)).toEqual({ editable: true, rows: [emptyWhereRow()] });
	});

	it("decomposes a lone leaf", () => {
		const r = predicateToRows({ $contains: { name: "alpha" } });
		expect(r).toEqual({
			editable: true,
			rows: [{ property: "name", op: WhereOp.Contains, value: "alpha" }],
		});
	});

	it("decomposes a flat $and into editable rows", () => {
		const r = predicateToRows({
			$and: [{ $eq: { status: "done" } }, { $lt: { priority: 5 } }],
		});
		expect(r.editable).toBe(true);
		expect(r.rows).toEqual([
			{ property: "status", op: WhereOp.Eq, value: "done" },
			{ property: "priority", op: WhereOp.Lt, value: "5" },
		]);
	});

	it("flags $or / $not as not flat-editable", () => {
		expect(predicateToRows({ $or: [{ $eq: { a: 1 } }] }).editable).toBe(false);
		expect(predicateToRows({ $not: { $eq: { a: 1 } } }).editable).toBe(false);
	});

	it("flags a nested $and child and a multi-key leaf as not editable", () => {
		const nested: PropertyPredicate = {
			$and: [{ $eq: { a: 1 } }, { $and: [{ $eq: { b: 2 } }] }],
		};
		expect(predicateToRows(nested).editable).toBe(false);
		expect(predicateToRows({ $eq: { a: 1, b: 2 } }).editable).toBe(false);
	});

	it("round-trips every flat predicate the builder can author", () => {
		const cases: PropertyPredicate[] = [
			{ $eq: { status: "done" } },
			{ $gt: { n: 3 } },
			{ $exists: { tag: true } },
			{ $and: [{ $eq: { a: "x" } }, { $neq: { b: 2 } }, { $empty: { c: true } }] },
		];
		for (const p of cases) {
			const decomposed = predicateToRows(p);
			expect(decomposed.editable).toBe(true);
			expect(rowsToPredicate(decomposed.rows)).toEqual(p);
		}
	});
});
