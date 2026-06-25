/**
 * In-folder search algorithm.
 *
 * Per docs/apps/42-file-manager-implementation.md §9.8.9: the active
 * folder's members are filtered live as the user types. Folding rules:
 *
 *   - case-folded (Unicode NFKD + lowercase)
 *   - diacritic-folded (combining marks stripped)
 *   - substring match (not just prefix) so "drop" matches "screenshots-drop.png"
 *
 * The same fold pipeline is used by `folder-tree.hasNameCollision`. Both
 * places import `foldName` from this module after this lands; until then
 * they're separately maintained equivalents (with the same regex).
 *
 * The walker (for subfolder + vault scope) is `walkScope` — it descends
 * the tree with a depth cap so a hostile cycle (shouldn't happen, but
 * cheap insurance) doesn't lock the UI.
 */

import type { Entity } from "../types/entity";
import { FOLDER_TYPE, readMembers, readName } from "../types/entity";
import type { FolderTree } from "./folder-tree";

export enum SearchScope {
	ActiveFolder = "active",
	Subfolders = "subfolders",
	Vault = "vault",
}

/** What clicking the scope chip does next (9.8.9). */
export enum ScopeFlipAction {
	/** Stay in-app: apply `scope` to the local search. */
	SetScope = "set-scope",
	/** Hand the query off to the shell's global search palette (the
	 *  launcher) and close the in-app search. */
	LauncherHandoff = "launcher-handoff",
}

export type ScopeFlip =
	| { action: ScopeFlipAction.SetScope; scope: SearchScope }
	| { action: ScopeFlipAction.LauncherHandoff };

/**
 * The scope chip cycles this-folder → subfolders → vault. When the shell
 * exposes `ui.openSearch` (`canHandOff`), the vault position IS the
 * launcher (per docs/apps/42-file-manager-implementation.md §9.8.9) — the
 * flip closes the in-app search and opens the global palette. Without the
 * service (older shell / standalone dev) the vault position stays the
 * local root-walk, so the chip never dead-ends.
 */
export function flipScope(current: SearchScope, canHandOff: boolean): ScopeFlip {
	if (current === SearchScope.ActiveFolder) {
		return { action: ScopeFlipAction.SetScope, scope: SearchScope.Subfolders };
	}
	if (current === SearchScope.Subfolders) {
		return canHandOff
			? { action: ScopeFlipAction.LauncherHandoff }
			: { action: ScopeFlipAction.SetScope, scope: SearchScope.Vault };
	}
	return { action: ScopeFlipAction.SetScope, scope: SearchScope.ActiveFolder };
}

const SCOPE_DEPTH_CAP = 64;

export function foldQuery(value: string): string {
	return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesQuery(name: string, foldedQuery: string): boolean {
	if (foldedQuery === "") return true;
	return foldQuery(name).includes(foldedQuery);
}

export type SearchInput = {
	tree: FolderTree;
	folderId: string;
	query: string;
	scope: SearchScope;
};

export function runSearch(input: SearchInput): Entity[] {
	const folded = foldQuery(input.query.trim());
	if (input.scope === SearchScope.ActiveFolder) {
		return input.tree
			.listFolderMembers(input.folderId)
			.filter((entity) => matchesQuery(readName(entity), folded));
	}
	const visited = new Set<string>();
	const out: Entity[] = [];
	const stack: Array<{ id: string; depth: number }> = [{ id: input.folderId, depth: 0 }];
	while (stack.length > 0) {
		const { id, depth } = stack.pop() as { id: string; depth: number };
		if (visited.has(id) || depth > SCOPE_DEPTH_CAP) continue;
		visited.add(id);
		const folder = input.tree.get(id);
		if (!folder || folder.type !== FOLDER_TYPE) continue;
		for (const memberId of readMembers(folder)) {
			const member = input.tree.get(memberId);
			if (!member || member.deletedAt !== null) continue;
			if (matchesQuery(readName(member), folded)) out.push(member);
			if (member.type === FOLDER_TYPE) stack.push({ id: memberId, depth: depth + 1 });
		}
	}
	return out;
}
