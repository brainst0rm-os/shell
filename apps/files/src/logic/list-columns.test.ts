import { describe, expect, it } from "vitest";
import {
	DEFAULT_LIST_COLUMNS,
	ListColumn,
	isListColumn,
	parseListColumns,
	toggleListColumn,
} from "./list-columns";

describe("list columns (9.8.11)", () => {
	it("parses a stored order, dropping junk and duplicates", () => {
		expect(parseListColumns(["size", "kind", "size", "bogus"])).toEqual([
			ListColumn.Size,
			ListColumn.Kind,
		]);
		expect(parseListColumns("nope")).toEqual(DEFAULT_LIST_COLUMNS);
		expect(parseListColumns([])).toEqual([]);
	});

	it("toggle removes in place and appends on re-enable (order = chosen order)", () => {
		const without = toggleListColumn(DEFAULT_LIST_COLUMNS, ListColumn.Kind);
		expect(without).toEqual([ListColumn.Modified]);
		expect(toggleListColumn(without, ListColumn.Kind)).toEqual([
			ListColumn.Modified,
			ListColumn.Kind,
		]);
	});

	it("guards wire values", () => {
		expect(isListColumn("modified")).toBe(true);
		expect(isListColumn("owner")).toBe(false);
	});
});
