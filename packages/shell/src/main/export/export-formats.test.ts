/**
 * IE-8 export serializers. Pure — tested directly, including round-trips back
 * through the IE-2/IE-4 import parsers to prove the two directions agree.
 */

import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseTable } from "../import/import-parse";
import { IMPORT_EXTERNAL_ID_PROP, ImportFormat } from "../import/import-types";
import {
	type ExportEntity,
	ExportFormat,
	entitiesToCsv,
	entitiesToJson,
	entityToMarkdown,
	exportEntities,
	exportScalar,
	extensionFor,
} from "./export-formats";

const ENTITIES: ExportEntity[] = [
	{
		id: "ent_1",
		type: "test/Note/v1",
		properties: {
			title: "First, with comma",
			tags: ["a", "b"],
			body: "Line one\nLine two",
			[IMPORT_EXTERNAL_ID_PROP]: "src:1", // must be stripped from every export
		},
	},
	{
		id: "ent_2",
		type: "test/Note/v1",
		properties: { title: "Second", count: 3, done: true },
	},
];
const [NOTE_A, NOTE_B] = ENTITIES as [ExportEntity, ExportEntity];

describe("exportScalar", () => {
	it("renders scalars, scalar arrays, and falls back to JSON", () => {
		expect(exportScalar("x")).toBe("x");
		expect(exportScalar(3)).toBe("3");
		expect(exportScalar(true)).toBe("true");
		expect(exportScalar(["a", "b"])).toBe("a; b");
		expect(exportScalar({ k: 1 })).toBe('{"k":1}');
		expect(exportScalar(null)).toBe("");
	});
});

describe("entitiesToJson", () => {
	it("emits one object for a single entity, an array otherwise, stripping the marker", () => {
		const one = JSON.parse(entitiesToJson([NOTE_A]));
		expect(one.id).toBe("ent_1");
		expect(one.properties.title).toBe("First, with comma");
		expect(IMPORT_EXTERNAL_ID_PROP in one.properties).toBe(false);
		const many = JSON.parse(entitiesToJson(ENTITIES));
		expect(Array.isArray(many)).toBe(true);
		expect(many).toHaveLength(2);
	});
});

describe("entitiesToCsv", () => {
	it("produces an RFC-4180 table the CSV parser reads back", () => {
		const csv = entitiesToCsv(ENTITIES);
		const table = parseTable(ImportFormat.Csv, csv);
		expect(table.columns).toEqual(["id", "title", "tags", "body", "count", "done"]);
		const first = table.records.find((r) => r.fields.id === "ent_1");
		expect(first?.fields.title).toBe("First, with comma"); // comma survives quoting
		expect(first?.fields.tags).toBe("a; b");
	});
});

describe("entityToMarkdown", () => {
	it("writes frontmatter + body that parseFrontmatter reads back", () => {
		const md = entityToMarkdown(NOTE_A);
		const { fields, body } = parseFrontmatter(md);
		expect(fields.title).toBe("First, with comma");
		expect(fields.tags).toBe("a; b");
		expect(IMPORT_EXTERNAL_ID_PROP in fields).toBe(false);
		expect("body" in fields).toBe(false); // body is the document body, not frontmatter
		expect(body.trim()).toBe("Line one\nLine two");
	});

	it("emits frontmatter-only when there is no body", () => {
		const md = entityToMarkdown(NOTE_B);
		expect(md).toContain("title: Second");
		expect(md).toContain("count: 3");
		expect(md.trimEnd().endsWith("---")).toBe(true);
	});
});

describe("exportEntities + extensionFor", () => {
	it("dispatches by format and gives the right extension", () => {
		expect(exportEntities(ExportFormat.Json, ENTITIES)).toBe(entitiesToJson(ENTITIES));
		expect(exportEntities(ExportFormat.Csv, ENTITIES)).toBe(entitiesToCsv(ENTITIES));
		expect(exportEntities(ExportFormat.Markdown, ENTITIES)).toContain("title: First");
		expect(extensionFor(ExportFormat.Markdown)).toBe("md");
		expect(extensionFor(ExportFormat.Csv)).toBe("csv");
		expect(extensionFor(ExportFormat.Json)).toBe("json");
	});
});
