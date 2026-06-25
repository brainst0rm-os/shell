/**
 * Reverse typed-relation browse (9.12.22) — the inverse of the rollup's
 * forward walk. The rollup engine (`rollup.ts`) reads a source row's EntityRef
 * relation *out* to the entities it points at; this answers the other
 * direction: **which entities point AT this one**, and through which relation
 * property. It scans every live row's properties for an EntityRef value (any
 * storage shape, via the shared `linkedEntityIds`) that includes the target id.
 *
 * Pure + synchronous over the in-memory mirror (same contract the entities
 * service will satisfy with an index later). Powers the inspector
 * "Referenced by" section — the entity-to-entity complement of the
 * "Collections containing this object" (list-membership) panel.
 */

import type { EntityRow } from "./in-memory-entities";
import { linkedEntityIds } from "./rollup";

/** One inbound reference: a `source` row whose `relationKey` property links to
 *  the queried entity. */
export type Backlink = {
	source: EntityRow;
	relationKey: string;
};

/** Property keys that are never user relations (shell-owned metadata) — skipped
 *  so an `ownerAppId` or similar can't masquerade as a backlink. */
const NON_RELATION_KEYS: ReadonlySet<string> = new Set([
	"id",
	"type",
	"icon",
	"name",
	"createdAt",
	"updatedAt",
	"deletedAt",
	"ownerAppId",
	"owner_app_id",
]);

/** Every live entity that references `entityId` through one of its EntityRef
 *  properties, paired with the property key that links them. A row never lists
 *  itself (a self-reference is dropped). Order follows `rows`; one row can
 *  appear once per distinct relation key that points at the target. */
export function backlinksFor(entityId: string, rows: readonly EntityRow[]): Backlink[] {
	const out: Backlink[] = [];
	for (const source of rows) {
		if (source.deletedAt != null || source.id === entityId) continue;
		for (const [relationKey, value] of Object.entries(source.properties)) {
			if (NON_RELATION_KEYS.has(relationKey)) continue;
			if (linkedEntityIds(value).includes(entityId)) {
				out.push({ source, relationKey });
			}
		}
	}
	return out;
}
