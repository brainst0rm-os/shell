/**
 * Canonical JSON for `.bsbundle` (IE-1).
 *
 * The byte-level round-trip guarantee compares two bundles byte-for-byte, so
 * every JSON file the bundle carries must serialize identically for identical
 * logical content — independent of object key insertion order (which can drift
 * through a SQLite store/parse cycle). `canonicalJson` emits object keys in
 * sorted order recursively; arrays keep their order (it's semantic).
 */

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = sortValue((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/** Stable, sorted-key JSON. Pretty-printed (2-space) for diff-friendliness —
 *  the format is meant to be inspectable. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortValue(value), null, 2);
}

/** Canonical JSONL: one canonical (single-line) JSON object per line. */
export function canonicalJsonl(rows: readonly unknown[]): string {
	return rows.map((row) => JSON.stringify(sortValue(row))).join("\n") + (rows.length ? "\n" : "");
}

export function parseJsonl(text: string): unknown[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}
