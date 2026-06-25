/**
 * Per-entity link partition + presentation helpers.
 *
 * The shell's `vaultEntities.list()` snapshot already carries the full
 * link graph (mentions + brainstorm:// link-markup edges) emitted by the
 * shell-side body walker — `extractNoteReferences` in
 * `packages/shell/src/main/entities/extract-note-references.ts`. The
 * Files inspector reuses that same shape to power a "Links to / Linked
 * from" panel; same authoritative graph the Graph app paints.
 *
 * These helpers stay pure-logic + DOM-free so the renderer can ship
 * them through `node` vitest without a jsdom env.
 */

export type EntityLink = {
	id: string;
	sourceEntityId: string;
	destEntityId: string;
	linkType: string;
};

export type EntityLinkPartition = {
	/** Edges where the entity is the source — "this note links out". */
	readonly outgoing: readonly EntityLink[];
	/** Edges where the entity is the destination — "this note is linked from". */
	readonly incoming: readonly EntityLink[];
};

const EMPTY_PARTITION: EntityLinkPartition = Object.freeze({
	outgoing: Object.freeze([]),
	incoming: Object.freeze([]),
});

/** Bucket `links` into outgoing + incoming for `entityId`. A self-loop
 *  (source === dest) lands in both buckets so the inspector surfaces
 *  it as a real edge in either direction. Empty input yields a frozen
 *  empty partition (stable identity across calls). */
export function partitionLinksForEntity(
	links: readonly EntityLink[],
	entityId: string,
): EntityLinkPartition {
	if (links.length === 0) return EMPTY_PARTITION;
	const outgoing: EntityLink[] = [];
	const incoming: EntityLink[] = [];
	for (const link of links) {
		if (link.sourceEntityId === entityId) outgoing.push(link);
		if (link.destEntityId === entityId) incoming.push(link);
	}
	return { outgoing, incoming };
}

/** Turn a wire-format link type into a short human label.
 *
 *   `io.brainstorm.notes/mention` → `Mention`
 *   `io.brainstorm.notes/link`    → `Link`
 *
 *  Unknown types fall through to the last `/`-delimited segment
 *  with the first character capitalised, so future link types
 *  (transclusion, etc.) read cleanly without a code change.
 *  Empty / whitespace inputs return an empty string — the caller
 *  hides the chip rather than rendering an empty pill. */
export function humanLinkType(linkType: string): string {
	const trimmed = linkType.trim();
	if (trimmed === "") return "";
	const lastSlash = trimmed.lastIndexOf("/");
	const tail = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
	if (tail.length === 0) return "";
	return tail.charAt(0).toUpperCase() + tail.slice(1);
}
