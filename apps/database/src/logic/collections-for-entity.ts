/**
 * The **reverse-lookup** half of the Collection contract: for one entity
 * id, which Lists effectively contain it, and *why* (the source matched,
 * a manual include added it, or an exclude is keeping it out even though
 * the source matched). Built on the existing forward path (`evaluateSource`
 * + `applyMemberOverrides`), so the formula is the same in both directions
 * by construction.
 *
 * Powers the inspector "Collections containing this object" panel
 * (9.3.5.U) and the cross-app "Add to collection…" affordance. Pure +
 * synchronous — the caller passes the in-memory entity mirror; SQL
 * resolution is the entities service's job once Lists move into
 * `entities.db`. Same shape works either way.
 */

import type { List } from "../types/list";
import { applyMemberOverrides, evaluateSource } from "./evaluate-source";
import type { InMemoryEntities } from "./in-memory-entities";

/** Why the entity is (or isn't) in a particular List. The values are
 *  load-bearing for the inspector badge label, so the enum is the single
 *  source of truth for both the logic layer and the renderer. */
export enum MembershipKind {
	/** The List's `source` query matches this entity (and no exclude
	 *  overrides it). The most common case. */
	Source = "source",
	/** The List's source does NOT match, but `members.include` carries
	 *  an explicit add. */
	Include = "include",
	/** The List's source matches, but `members.exclude` is keeping the
	 *  entity out. Surfaced so the user can see *why* a manual exclude
	 *  is hiding a row that "should" be there. */
	Excluded = "excluded",
}

/** One row of the reverse-lookup result. */
export type CollectionMembership = {
	list: List;
	kind: MembershipKind;
};

/**
 * For one entity, return every List whose effective membership the
 * entity participates in — plus the Lists actively excluding it.
 *
 * Order preserved from the input `lists` array so the renderer doesn't
 * have to re-sort. Vault-derived lists (the "all of type X" rollups
 * built by `buildVaultLists`) are included on equal footing with
 * user-created lists — the renderer can filter them out per-surface if
 * it wants to (the inspector hides them, the picker shows them).
 */
export function collectionsForEntity(
	entityId: string,
	lists: ReadonlyArray<List>,
	db: InMemoryEntities,
): CollectionMembership[] {
	const out: CollectionMembership[] = [];
	for (const list of lists) {
		const kind = membershipKindFor(entityId, list, db);
		if (kind !== null) out.push({ list, kind });
	}
	return out;
}

/** Same as the loop body in `collectionsForEntity`, exported for
 *  surfaces that only need to ask "is X in this one List, and how?"
 *  (e.g. the row's quick-toggle in the cross-app "Add to collection"
 *  popover). Returns `null` when the entity has no relationship to
 *  the List at all (source miss + not in either overrides list). */
export function membershipKindFor(
	entityId: string,
	list: List,
	db: InMemoryEntities,
): MembershipKind | null {
	const resolved = evaluateSource(list.source, db);
	const sourceMatch = resolved.has(entityId);
	const effective = applyMemberOverrides(resolved, list.members.include, list.members.exclude);
	if (effective.has(entityId)) {
		return sourceMatch ? MembershipKind.Source : MembershipKind.Include;
	}
	// Not in effective. Distinguish "explicit exclude" from "no relationship".
	if (sourceMatch) return MembershipKind.Excluded;
	return null;
}

/** Convenience: does the source alone match? Needed by `addToList` /
 *  `removeFromList` callers (the `matchesSource` field of `MutationContext`)
 *  so they take a minimal-write action against `members`. Re-exported here
 *  so callers don't need a direct dep on `evaluate-source`. */
export function sourceMatches(entityId: string, list: List, db: InMemoryEntities): boolean {
	return evaluateSource(list.source, db).has(entityId);
}

/**
 * Filter `lists` to those that the "Add to collection…" picker should
 * offer for `entityId`. Drops:
 *   - vault-derived lists (membership = type; nothing manual to commit)
 *   - lists where the entity already participates via Source or Include
 *
 * Keeps lists where the entity is currently Excluded — picking such a
 * list "Adds back" (un-excludes) the entity, which is the user-expected
 * inverse of having clicked ✕ earlier.
 *
 * Vault-derived id detection is injected so this stays pure and
 * dependency-free; the caller (the database app) supplies its existing
 * `isVaultDerivedListId` predicate.
 */
export function pickerCandidatesForEntity(
	entityId: string,
	lists: ReadonlyArray<List>,
	db: InMemoryEntities,
	isVaultDerived: (listId: string) => boolean,
): List[] {
	const out: List[] = [];
	for (const list of lists) {
		if (isVaultDerived(list.id)) continue;
		const kind = membershipKindFor(entityId, list, db);
		if (kind === null || kind === MembershipKind.Excluded) out.push(list);
	}
	return out;
}
