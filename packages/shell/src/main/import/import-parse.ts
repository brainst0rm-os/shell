/**
 * Parse stage (IE-2 + IE-4) — bytes → normalized {@link ParsedTable}.
 *
 * Native, zero-dependency adapters: JSON + JSONL (IE-2 reference) and the
 * generic CSV / Markdown / HTML adapters (IE-4, doc 45 §Parse/Map split). All
 * fold onto the same IR — this stage only emits the column/record shape the Map
 * stage consumes, never reaches into vault state, and never reuses the Database
 * app's CSV parser (a shell→app layering violation). HTML/Markdown values are
 * extracted as plain text (tags stripped, entities decoded); no markup reaches
 * the typed-value layer, so an imported document can't smuggle executable
 * content through the Parse stage.
 */

import {
	ImportFormat as Format,
	type ImportFormat,
	type ImportRecord,
	type ParsedTable,
} from "./import-types";

/** Heuristic external-id keys: if a record carries one of these, it becomes the
 *  row's `externalId` so re-import is idempotent. First match wins. */
const EXTERNAL_ID_KEYS = ["id", "externalId", "external_id", "uid", "uuid", "guid"];

function pickExternalId(fields: Record<string, unknown>): string | null {
	for (const key of EXTERNAL_ID_KEYS) {
		const value = fields[key];
		if (typeof value === "string" && value.length > 0) return value;
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return null;
}

function toRecord(value: unknown): ImportRecord | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const fields = value as Record<string, unknown>;
	return { externalId: pickExternalId(fields), fields };
}

function collectColumns(records: readonly ImportRecord[]): string[] {
	const seen = new Set<string>();
	const order: string[] = [];
	for (const record of records) {
		for (const key of Object.keys(record.fields)) {
			if (!seen.has(key)) {
				seen.add(key);
				order.push(key);
			}
		}
	}
	return order;
}

function recordsToTable(name: string, raw: readonly unknown[]): ParsedTable {
	const records: ImportRecord[] = [];
	for (const item of raw) {
		const record = toRecord(item);
		if (record) records.push(record);
	}
	return { name, columns: collectColumns(records), records };
}

/**
 * Split CSV text into rows of string cells (RFC 4180): double-quoted fields may
 * contain commas, CRLF/LF newlines, and `""`-escaped quotes. Blank lines drop.
 */
function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field += ch;
			i += 1;
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			i += 1;
			continue;
		}
		if (ch === ",") {
			row.push(field);
			field = "";
			i += 1;
			continue;
		}
		if (ch === "\r") {
			i += 1;
			continue;
		}
		if (ch === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			i += 1;
			continue;
		}
		field += ch;
		i += 1;
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function parseCsv(text: string): unknown[] {
	const rows = parseCsvRows(text);
	const header = rows[0];
	if (!header) return [];
	return rows.slice(1).map((cells) => {
		const obj: Record<string, unknown> = {};
		header.forEach((col, idx) => {
			const key = col.trim() || `col${idx + 1}`;
			obj[key] = cells[idx] ?? "";
		});
		return obj;
	});
}

/** Minimal YAML-frontmatter extraction: a leading `---` fence with `key: value`
 *  lines (surrounding quotes stripped). Returns the parsed fields + the body
 *  after the fence. Shared by the Markdown adapter and the IE-5 Obsidian
 *  importer (which also needs the raw body to scan for `[[wikilinks]]`). */
export function parseFrontmatter(text: string): {
	fields: Record<string, string>;
	body: string;
} {
	const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	const fields: Record<string, string> = {};
	if (fence?.[1] === undefined) return { fields, body: text };
	for (const line of fence[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const key = line.slice(0, idx).trim();
		if (!key) continue;
		let value = line.slice(idx + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		fields[key] = value;
	}
	return { fields, body: text.slice(fence[0].length) };
}

function parseMarkdown(text: string, name: string): unknown[] {
	const { fields: parsed, body } = parseFrontmatter(text);
	const fields: Record<string, unknown> = { ...parsed };
	if (body.trim().length > 0) fields.body = body.trim();
	if (typeof fields.title !== "string") fields.title = name;
	return [fields];
}

function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

/** Strip tags + collapse whitespace to plain text (no markup survives). */
function htmlCellText(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function parseHtml(text: string, name: string): unknown[] {
	const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(text);
	if (!tableMatch?.[1]) {
		const body = htmlCellText(text);
		return body.length > 0 ? [{ title: name, body }] : [];
	}
	const rows: string[][] = [];
	const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch: RegExpExecArray | null = rowRe.exec(tableMatch[1]);
	while (rowMatch !== null) {
		const cells: string[] = [];
		const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
		let cellMatch: RegExpExecArray | null = cellRe.exec(rowMatch[1] ?? "");
		while (cellMatch !== null) {
			cells.push(htmlCellText(cellMatch[1] ?? ""));
			cellMatch = cellRe.exec(rowMatch[1] ?? "");
		}
		if (cells.length > 0) rows.push(cells);
		rowMatch = rowRe.exec(tableMatch[1]);
	}
	const header = rows[0];
	if (!header) return [];
	return rows.slice(1).map((cells) => {
		const obj: Record<string, unknown> = {};
		header.forEach((col, idx) => {
			obj[col || `col${idx + 1}`] = cells[idx] ?? "";
		});
		return obj;
	});
}

/** Parse a source text into a normalized table. JSON may be one object or an
 *  array; JSONL is one object per line; CSV/HTML are tabular (header row →
 *  columns); Markdown is one record from its frontmatter + body. */
export function parseTable(format: ImportFormat, text: string, name = "import"): ParsedTable {
	switch (format) {
		case Format.Json: {
			const parsed = JSON.parse(text) as unknown;
			const rows = Array.isArray(parsed) ? parsed : [parsed];
			return recordsToTable(name, rows);
		}
		case Format.Jsonl: {
			const rows = text
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as unknown);
			return recordsToTable(name, rows);
		}
		case Format.Csv:
			return recordsToTable(name, parseCsv(text));
		case Format.Markdown:
			return recordsToTable(name, parseMarkdown(text, name));
		case Format.Html:
			return recordsToTable(name, parseHtml(text, name));
	}
}
