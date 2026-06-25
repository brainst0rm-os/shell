/**
 * Smart folders (saved searches) — the app-local half of 9.8.9.
 *
 * A smart folder captures a search the way the user ran it: the query
 * string, the scope (this folder / subfolders / vault), and the folder it
 * was scoped from. Activating one re-runs that search; nothing about the
 * result set is frozen, so a smart folder is a live filter, not a snapshot.
 *
 * Persistence mirrors `view-options.ts`: one versioned JSON blob in the
 * renderer-local `localStorage`, scoped by the per-vault discriminator so
 * the shared app origin never bleeds one vault's saved searches into
 * another's. Every read re-validates with guards (scope enum, non-empty
 * query/name) so a corrupted or cross-build blob degrades to "no saved
 * searches" rather than poisoning the sidebar.
 *
 * The launcher hand-off ("flip to launcher" in the 9.8.9 spec) is the
 * shell-side follow-up; this module is entirely app-local.
 */

import { SearchScope } from "./search";

export type SmartFolder = {
	id: string;
	name: string;
	query: string;
	scope: SearchScope;
	/** The folder the search was scoped from. Subfolder/vault scopes walk
	 *  from here; the active-folder scope re-applies against it. */
	folderId: string;
	createdAt: number;
};

const STORE_KEY = "brainstorm.files.smartFolders.v1";

/** Hard ceiling so a runaway "save" loop can't grow the blob without bound.
 *  Saving past the cap drops the oldest entry (FIFO). */
export const MAX_SMART_FOLDERS = 50;

const NAME_MAX_LENGTH = 120;

function storeKeyFor(vaultKey?: string): string {
	return vaultKey ? `${STORE_KEY}:${vaultKey}` : STORE_KEY;
}

function isScope(value: unknown): value is SearchScope {
	return (
		value === SearchScope.ActiveFolder ||
		value === SearchScope.Subfolders ||
		value === SearchScope.Vault
	);
}

function parseSmartFolder(raw: unknown): SmartFolder | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "string" || r.id.length === 0) return null;
	if (typeof r.name !== "string" || r.name.trim().length === 0) return null;
	if (typeof r.query !== "string" || r.query.trim().length === 0) return null;
	if (!isScope(r.scope)) return null;
	if (typeof r.folderId !== "string" || r.folderId.length === 0) return null;
	return {
		id: r.id,
		name: r.name,
		query: r.query,
		scope: r.scope,
		folderId: r.folderId,
		createdAt: typeof r.createdAt === "number" && r.createdAt > 0 ? r.createdAt : 0,
	};
}

export function readSmartFolders(vaultKey?: string): SmartFolder[] {
	try {
		const raw = globalThis.localStorage?.getItem(storeKeyFor(vaultKey));
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: SmartFolder[] = [];
		for (const value of parsed) {
			const folder = parseSmartFolder(value);
			if (folder) out.push(folder);
		}
		return out;
	} catch {
		return [];
	}
}

function writeSmartFolders(folders: readonly SmartFolder[], vaultKey?: string): void {
	try {
		globalThis.localStorage?.setItem(storeKeyFor(vaultKey), JSON.stringify(folders));
	} catch {
		// Quota / disabled — the live React state still reflects the change
		// for this session; it just won't survive a reload.
	}
}

/** Trim + clamp a user-entered name; falls back to the trimmed query when
 *  the name is blank (so "Save" with an empty name is still meaningful). */
export function normalizeSmartFolderName(name: string, query: string): string {
	const trimmed = name.trim();
	const base = trimmed.length > 0 ? trimmed : query.trim();
	return base.slice(0, NAME_MAX_LENGTH);
}

export type SaveSmartFolderInput = {
	name: string;
	query: string;
	scope: SearchScope;
	folderId: string;
	/** Injected so the module stays free of `Date.now()` (testable, and the
	 *  store owns the clock). */
	now: number;
	/** Injected id (the store mints it via the same generator it uses for
	 *  entities) so this module stays free of `crypto`. */
	id: string;
};

/** Append a saved search. A blank query is rejected (returns the list
 *  unchanged) — there's nothing to save. The name is normalized; an exact
 *  duplicate (same name + query + scope + folderId) is collapsed so repeated
 *  "Save" clicks don't stack identical rows. FIFO-evicts at the cap. */
export function saveSmartFolder(
	existing: readonly SmartFolder[],
	input: SaveSmartFolderInput,
	vaultKey?: string,
): SmartFolder[] {
	const query = input.query.trim();
	if (query === "") return [...existing];
	const name = normalizeSmartFolderName(input.name, query);
	const duplicate = existing.some(
		(f) =>
			f.name === name && f.query === query && f.scope === input.scope && f.folderId === input.folderId,
	);
	if (duplicate) return [...existing];
	const next: SmartFolder = {
		id: input.id,
		name,
		query,
		scope: input.scope,
		folderId: input.folderId,
		createdAt: input.now,
	};
	const grown = [...existing, next];
	const capped =
		grown.length > MAX_SMART_FOLDERS ? grown.slice(grown.length - MAX_SMART_FOLDERS) : grown;
	writeSmartFolders(capped, vaultKey);
	return capped;
}

export function deleteSmartFolder(
	existing: readonly SmartFolder[],
	id: string,
	vaultKey?: string,
): SmartFolder[] {
	const next = existing.filter((f) => f.id !== id);
	if (next.length === existing.length) return [...existing];
	writeSmartFolders(next, vaultKey);
	return next;
}

export function renameSmartFolder(
	existing: readonly SmartFolder[],
	id: string,
	name: string,
	vaultKey?: string,
): SmartFolder[] {
	let changed = false;
	const next = existing.map((f) => {
		if (f.id !== id) return f;
		const normalized = normalizeSmartFolderName(name, f.query);
		if (normalized === f.name) return f;
		changed = true;
		return { ...f, name: normalized };
	});
	if (!changed) return [...existing];
	writeSmartFolders(next, vaultKey);
	return next;
}
