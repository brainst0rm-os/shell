/**
 * Pure text helpers for the launcher (FTS5 snippet sanitising + entity-type
 * pretty-printing). Split from `./launcher` so the component module exports
 * only the component (Fast Refresh requires component files to export nothing
 * else). Unit-tested directly via `launcher.test.ts`.
 */

/** Allowlist-based sanitiser for FTS5 snippets. The indexer wraps matches
 *  in literal `<mark>` / `</mark>` tags we control; we keep those and
 *  escape everything else from the source body so a note that happens to
 *  contain HTML can't break out of the highlight. Pure string-level —
 *  no DOM parse, fine for non-interactive previews. */
export function sanitizeSnippet(raw: string): string {
	// Tokenise around the literal markers. Anything else escapes as text.
	const out: string[] = [];
	let cursor = 0;
	const pattern = /<\/?mark>/g;
	let match = pattern.exec(raw);
	while (match) {
		out.push(escapeHtml(raw.slice(cursor, match.index)));
		out.push(match[0]);
		cursor = match.index + match[0].length;
		match = pattern.exec(raw);
	}
	out.push(escapeHtml(raw.slice(cursor)));
	return out.join("");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Pretty-print an entity type id. `io.brainstorm.notes/Note/v1` → `Note`.
 *  Falls back to the raw id for shapes we don't recognise. */
export function prettyEntityType(typeId: string): string {
	const parts = typeId.split("/");
	if (parts.length >= 3) return parts[parts.length - 2] ?? typeId;
	return typeId;
}
