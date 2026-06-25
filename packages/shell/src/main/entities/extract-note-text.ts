/**
 * Shell-side mirror of `apps/notes/src/editor/extract-text.ts`.
 * Flattens a Lexical `SerializedEditorState` (the JSON body persisted in a
 * note's kv blob) to a plain string for FTS5 indexing.
 *
 * Why duplicate the walker instead of importing? Same reason as
 * `extract-note-references.ts` — the shell main process can't depend on app
 * code, and the persisted Lexical shape is the long-lived contract. When the
 * entities service (Stage 9.3) lands, both walkers fold into the same
 * indexer pipeline.
 *
 * Tolerates legacy string bodies (returned trimmed + space-collapsed) and
 * malformed shapes (returned as `""`). Never throws; never reads anything
 * outside `text` / `label` / `children`.
 */

import { MENTION_NODE_TYPE } from "./extract-note-references";

export function extractNoteBodyText(body: unknown): string {
	if (!body) return "";
	if (typeof body === "string") return body.replace(/\s+/g, " ").trim();
	if (typeof body !== "object") return "";
	const root = (body as { root?: unknown }).root;
	const parts: string[] = [];
	collect(root, parts);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collect(node: unknown, out: string[]): void {
	if (!node || typeof node !== "object") return;
	const record = node as {
		type?: unknown;
		text?: unknown;
		label?: unknown;
		children?: unknown;
	};
	if (typeof record.text === "string" && record.text.length > 0) {
		out.push(record.text);
	} else if (record.type === MENTION_NODE_TYPE && typeof record.label === "string") {
		out.push(record.label);
	}
	if (Array.isArray(record.children)) {
		for (const child of record.children) collect(child, out);
	}
}
