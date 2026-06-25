/**
 * OQ-GR-3 — `created_at` backfill for legacy graph data.
 *
 * Vaults upgraded from a build before link/entity `created_at` was
 * reliably written carry rows with a missing (0 / non-finite) timestamp.
 * Without a fix those elements pile onto the history timeline at epoch 0
 * — dragging the scrubber bounds back to 1970 and making every reveal
 * mode (9.13.10a) useless.
 *
 * Resolution (OQ-GR-3 option **c**, the tentative leaning): a link's
 * timestamp is `MAX(link.created_at, source_entity.created_at)` — an
 * edge can't predate the node it leaves, and a missing link timestamp
 * inherits its source's ("the edge appeared around when the source
 * did"). An entity (or a link whose source is itself timeless / absent)
 * with no usable timestamp falls back to the **minimum known** timestamp
 * across the graph, so a legacy element shows near frame 0 rather than
 * at the epoch.
 *
 * Pure + idempotent: returns a fresh `InMemoryGraph`, never mutates the
 * input, and `backfill(backfill(g))` deep-equals `backfill(g)` (a real
 * timestamp is only ever pushed later, never rewritten on a second
 * pass). Applied once where the vault snapshot becomes the in-memory
 * graph (`app.ts`'s `loadVaultEntities`); the keystone survives the
 * Stage 9.3 entities-service swap unchanged.
 */

import type { EntityRow, InMemoryGraph, LinkRow } from "./in-memory-graph";

/** A timestamp we can place on the timeline: a positive finite epoch-ms.
 *  Real vault timestamps are ~1.7e12; legacy gaps are 0 / NaN / negative. */
function isUsable(ts: number): boolean {
	return Number.isFinite(ts) && ts > 0;
}

/** Smallest usable timestamp anywhere in the graph — the floor a
 *  timeless element snaps to (frame-0-ish, not 1970). `0` when the graph
 *  has no usable timestamp at all (degenerate: the result is a no-op
 *  rather than a crash). */
function minKnownTimestamp(graph: InMemoryGraph): number {
	let min = Number.POSITIVE_INFINITY;
	for (const e of graph.entities) {
		if (isUsable(e.createdAt) && e.createdAt < min) min = e.createdAt;
	}
	for (const l of graph.links) {
		if (isUsable(l.createdAt) && l.createdAt < min) min = l.createdAt;
	}
	return Number.isFinite(min) ? min : 0;
}

export function backfillCreatedAt(graph: InMemoryGraph): InMemoryGraph {
	const floor = minKnownTimestamp(graph);

	const entities: EntityRow[] = graph.entities.map((e) =>
		isUsable(e.createdAt) ? e : { ...e, createdAt: floor },
	);

	// Index the *backfilled* entity timestamps so a link whose source was
	// itself timeless still resolves to the floor (transitively correct).
	const tsById = new Map<string, number>();
	for (const e of entities) tsById.set(e.id, e.createdAt);

	const links: LinkRow[] = graph.links.map((l) => {
		const sourceTs = tsById.get(l.sourceEntityId);
		const srcTs = sourceTs !== undefined && isUsable(sourceTs) ? sourceTs : floor;
		const linkTs = isUsable(l.createdAt) ? l.createdAt : 0;
		// MAX(link, source): a real link ts is never moved earlier; a
		// missing one (0) inherits the source. Both gone ⇒ srcTs is the
		// floor, so the result is still the floor (never 0).
		const next = Math.max(linkTs, srcTs);
		return next === l.createdAt ? l : { ...l, createdAt: next };
	});

	return { entities, links };
}
