/**
 * In-memory shape mirroring an `entities.db` row + the link table. This is
 * the canonical client-side vault snapshot: the same shapes the entities
 * service returns (Stage 9.3) flow through app renderers, demo datasets,
 * and unit tests today via `vaultEntities.list()` (Stage 9.13.1.8).
 *
 * Extracted to the SDK because Database (`logic/in-memory-entities.ts`) and
 * Graph (`logic/in-memory-graph.ts`) had defined `EntityRow` / `LinkRow`
 * field-for-field identically. One source of truth so the shape can't
 * drift between the two consumers (and any future preview/test fixtures).
 */

export type EntityRow = {
	id: string;
	type: string;
	properties: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
};

export type LinkRow = {
	id: string;
	sourceEntityId: string;
	destEntityId: string;
	linkType: string;
	/** Human-meaningful elaboration of *why* this link exists, beyond the
	 *  machine `linkType`: the shared value for a shared-attribute edge
	 *  ("Acme"), or the source property name for a property reference
	 *  ("Assignee"). Optional — body/structured edges leave it unset and the
	 *  consumer falls back to a label derived from `linkType` alone. */
	detail?: string;
	createdAt: number;
	deletedAt: number | null;
};

/** A whole in-memory vault snapshot: live (non-deleted) entities + links. */
export type InMemoryVault = {
	entities: ReadonlyArray<EntityRow>;
	links: ReadonlyArray<LinkRow>;
};

export function emptyVault(): InMemoryVault {
	return { entities: [], links: [] };
}

/** Read a property value at a dotted path (`tags`, `phones.value`, etc.).
 *  Single-segment paths read the property directly. Two-segment paths
 *  inspect arrays of `{value, label?}` envelopes, returning the matching
 *  field across every entry (so `phones.value` returns `["+1…", "+2…"]`).
 *  Mirrors the path semantics documented at
 *  §Querying. */
export function readPropertyPath(entity: EntityRow, path: string): unknown {
	const dot = path.indexOf(".");
	if (dot === -1) return entity.properties[path];
	const head = path.slice(0, dot);
	const tail = path.slice(dot + 1);
	const root = entity.properties[head];
	if (Array.isArray(root)) {
		const out: unknown[] = [];
		for (const item of root) {
			if (item && typeof item === "object" && tail in (item as Record<string, unknown>)) {
				out.push((item as Record<string, unknown>)[tail]);
			}
		}
		return out;
	}
	if (root && typeof root === "object" && tail in (root as Record<string, unknown>)) {
		return (root as Record<string, unknown>)[tail];
	}
	return undefined;
}
