/**
 * Resolves an entity id to its open-routing coordinates — the BP `type`
 * and (for file-shaped entities) the `mime`.
 *
 * Why this exists: a click usually only carries the *entity id* (a Notes
 * `@`-mention, a graph node, a "Linked from" row). The intents bus matches
 * handlers on `entityType` / `mime`, so without resolving the id to a type
 * the dispatch falls through to wildcard-only handlers and a type-specific
 * opener (Notes for `Note/v1`, Files for `Folder/v1`, Preview for an image)
 * is never selected. Resolution is shell-side so apps never need read
 * capability on the target just to navigate to it (per
 * docs/platform/31-linking-protocol.md §Resolution — resolution is always
 * shell-mediated).
 */

import type { EntitiesRepository } from "../storage/entities-repo";

export type EntityTarget = {
	type?: string;
	mime?: string;
};

export type EntityTargetResolver = (entityId: string) => Promise<EntityTarget | null>;

/** The two property keys a file-as-entity uses for its MIME, in order of
 *  preference. Kept here so the open resolver and any future file indexer
 *  read the same shape. */
const MIME_PROPERTY_KEYS = ["mime", "mimeType"] as const;

export function mimeFromProperties(properties: Record<string, unknown>): string | undefined {
	for (const key of MIME_PROPERTY_KEYS) {
		const value = properties[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/**
 * Build a resolver over the active vault's entities repo. Per-call repo
 * lookup (not a captured handle) so a vault switch can't read a closed DB.
 * Any failure resolves to `null` — the bus then falls back to whatever the
 * caller put in the payload, never throwing the navigation.
 */
export function makeEntityTargetResolver(
	getRepo: () => Promise<EntitiesRepository | null>,
): EntityTargetResolver {
	return async (entityId: string): Promise<EntityTarget | null> => {
		try {
			const repo = await getRepo();
			if (!repo) return null;
			const row = repo.get(entityId);
			if (!row) return null;
			const mime = mimeFromProperties(row.properties);
			return mime !== undefined ? { type: row.type, mime } : { type: row.type };
		} catch {
			return null;
		}
	};
}
