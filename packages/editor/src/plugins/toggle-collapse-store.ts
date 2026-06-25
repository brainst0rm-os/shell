/**
 * Per-device collapsed-state store for toggle blocks (B11.5).
 *
 * Collapsed/expanded is renderer-local chrome, not synced body content, so
 * it lives here keyed by the toggle's persisted `__bsId` — never in the
 * YDoc. Backed by `localStorage` (one JSON id-array per document, mirroring
 * the code-block word-wrap pref precedent) with an in-memory fallback for
 * environments without `localStorage` (or when no doc id is supplied), so
 * the editor package never hard-depends on web storage.
 */

const STORAGE_PREFIX = "bs.toggle.";

function storageKey(docId: string): string {
	return STORAGE_PREFIX + docId;
}

function readLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		// Access itself can throw (sandboxed / disabled storage).
		return null;
	}
}

export class ToggleCollapseStore {
	private readonly docId: string | undefined;
	private readonly memory = new Set<string>();

	constructor(docId?: string) {
		this.docId = docId && docId.length > 0 ? docId : undefined;
	}

	private read(): Set<string> {
		if (!this.docId) return this.memory;
		const storage = readLocalStorage();
		if (!storage) return this.memory;
		try {
			const raw = storage.getItem(storageKey(this.docId));
			if (!raw) return new Set();
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set();
		} catch {
			return new Set();
		}
	}

	private write(ids: Set<string>): void {
		if (!this.docId) return;
		const storage = readLocalStorage();
		if (!storage) return;
		try {
			const key = storageKey(this.docId);
			if (ids.size === 0) storage.removeItem(key);
			else storage.setItem(key, JSON.stringify([...ids]));
		} catch {
			// Quota / disabled storage — collapse stays session-only.
		}
	}

	isCollapsed(blockId: string): boolean {
		return this.read().has(blockId);
	}

	setCollapsed(blockId: string, collapsed: boolean): void {
		// For the in-memory fallback `read()` returns the live `memory` set, so
		// mutating `ids` updates it in place; `write()` no-ops without a docId.
		const ids = this.read();
		if (collapsed) ids.add(blockId);
		else ids.delete(blockId);
		this.write(ids);
	}

	toggle(blockId: string): boolean {
		const next = !this.isCollapsed(blockId);
		this.setCollapsed(blockId, next);
		return next;
	}
}
