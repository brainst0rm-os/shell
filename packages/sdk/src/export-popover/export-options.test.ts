import { describe, expect, it } from "vitest";
import {
	ExportOptionKind,
	type ExportPopoverSpec,
	defaultValuesFor,
	exportValuesComplete,
	initialFormatId,
	optionsForFormat,
	reconcileValues,
} from "./export-options";

const spec: ExportPopoverSpec = {
	commonOptions: [
		{
			kind: ExportOptionKind.Checklist,
			id: "columns",
			label: "Columns",
			choices: [
				{ value: "a", label: "A" },
				{ value: "b", label: "B" },
			],
			default: ["a", "b"],
		},
	],
	formats: [
		{
			id: "csv",
			label: "CSV",
			options: [
				{ kind: ExportOptionKind.Toggle, id: "header", label: "Header", default: true },
				{
					kind: ExportOptionKind.Select,
					id: "delimiter",
					label: "Delimiter",
					choices: [
						{ value: ",", label: "Comma" },
						{ value: "\t", label: "Tab" },
					],
					default: ",",
				},
			],
		},
		{
			id: "json",
			label: "JSON",
			options: [{ kind: ExportOptionKind.Toggle, id: "pretty", label: "Pretty", default: true }],
		},
		{ id: "md", label: "Markdown" },
	],
};

describe("initialFormatId", () => {
	it("uses the first format by default", () => {
		expect(initialFormatId(spec)).toBe("csv");
	});
	it("honours a valid defaultFormatId", () => {
		expect(initialFormatId({ ...spec, defaultFormatId: "json" })).toBe("json");
	});
	it("falls back to the first format when the requested default is unknown", () => {
		expect(initialFormatId({ ...spec, defaultFormatId: "nope" })).toBe("csv");
	});
});

describe("optionsForFormat", () => {
	it("returns common options then the format's own, in order", () => {
		expect(optionsForFormat(spec, "csv").map((o) => o.id)).toEqual([
			"columns",
			"header",
			"delimiter",
		]);
	});
	it("returns just the common options for a format with none of its own", () => {
		expect(optionsForFormat(spec, "md").map((o) => o.id)).toEqual(["columns"]);
	});
	it("returns just the common options for an unknown format id", () => {
		expect(optionsForFormat(spec, "ghost").map((o) => o.id)).toEqual(["columns"]);
	});
});

describe("defaultValuesFor", () => {
	it("seeds each active option with its default (checklist cloned)", () => {
		const values = defaultValuesFor(spec, "csv");
		expect(values).toEqual({ columns: ["a", "b"], header: true, delimiter: "," });
		// The clone must not alias the spec's default array.
		(values.columns as string[]).push("x");
		expect(spec.commonOptions?.[0]).toMatchObject({ default: ["a", "b"] });
	});
});

describe("reconcileValues", () => {
	it("carries matching values across a format switch, resets the rest to defaults", () => {
		const csv = { columns: ["a"], header: false, delimiter: "\t" };
		const json = reconcileValues(spec, "json", csv);
		// `columns` is common → carried; `pretty` is JSON-only → default; CSV-only
		// options drop out entirely.
		expect(json).toEqual({ columns: ["a"], pretty: true });
	});

	it("falls back to default when a carried value has the wrong shape", () => {
		const bad = { columns: "not-an-array" as unknown as string[] };
		const next = reconcileValues(spec, "md", bad);
		expect(next).toEqual({ columns: ["a", "b"] });
	});
});

describe("exportValuesComplete", () => {
	const requireOneSpec: ExportPopoverSpec = {
		commonOptions: [
			{
				kind: ExportOptionKind.Checklist,
				id: "columns",
				label: "Columns",
				choices: [{ value: "a", label: "A" }],
				default: ["a"],
				requireOne: true,
			},
		],
		formats: [{ id: "csv", label: "CSV" }],
	};

	it("is false when a requireOne checklist is empty", () => {
		const options = optionsForFormat(requireOneSpec, "csv");
		expect(exportValuesComplete(options, { columns: [] })).toBe(false);
	});
	it("is true when the requireOne checklist has a selection", () => {
		const options = optionsForFormat(requireOneSpec, "csv");
		expect(exportValuesComplete(options, { columns: ["a"] })).toBe(true);
	});
	it("ignores checklists without requireOne", () => {
		const options = optionsForFormat(spec, "csv");
		expect(exportValuesComplete(options, { columns: [], header: true, delimiter: "," })).toBe(true);
	});
});
