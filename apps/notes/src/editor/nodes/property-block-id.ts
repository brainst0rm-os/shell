/**
 * Persistent id for a property block. Same `<prefix>_<base36-now>_<rand6>`
 * shape as `newNoteId` / `newPropertyKey` so logs and exports read
 * uniformly. The id rides through `exportJSON` / `importJSON` so paste,
 * duplicate, and reload all keep the original — separate from Lexical's
 * per-session `__key`.
 */

export const PROPERTY_BLOCK_ID_PREFIX = "pb_";
export const PROPERTY_LIST_BLOCK_ID_PREFIX = "plb_";

export function newPropertyBlockId(): string {
	const t = Date.now().toString(36);
	const r = Math.random().toString(36).slice(2, 8);
	return `${PROPERTY_BLOCK_ID_PREFIX}${t}_${r}`;
}

export function newPropertyListBlockId(): string {
	const t = Date.now().toString(36);
	const r = Math.random().toString(36).slice(2, 8);
	return `${PROPERTY_LIST_BLOCK_ID_PREFIX}${t}_${r}`;
}
