/**
 * Shared RFC-4180-ish CSV row tokenizer. Extracted from `contact-import.ts`
 * when the generic CSV-import column inference (9.12.19) became the second
 * consumer — one parser, two callers ([[feedback_extract_to_sdk_at_copy_two]]
 * applied app-locally). `contact-import` re-exports it so its sites are
 * unchanged.
 */

/** RFC 4180-ish tokenizer: quoted fields, `""` escape, embedded
 *  commas/newlines inside quotes. Returns rows of string cells; fully-blank
 *  rows are dropped. */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				cell += ch;
			}
			continue;
		}
		if (ch === '"') quoted = true;
		else if (ch === ",") {
			row.push(cell);
			cell = "";
		} else if (ch === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += ch;
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
