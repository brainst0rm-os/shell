/**
 * 9.12.10 — dependency edges for the Timeline view. The layout declares
 * which typed-link names count as predecessor edges
 * (`dependencyLinkTypes`); this resolves the vault's link rows against
 * the items actually on the timeline, so the renderer only draws arrows
 * whose both ends are visible. Pure — the renderer owns coordinates.
 */

export type DependencyLinkInput = {
	sourceEntityId: string;
	destEntityId: string;
	linkType: string;
};

export type DependencyEdge = { fromId: string; toId: string };

/** Links whose type is allowed and whose BOTH endpoints are on-timeline,
 *  de-duplicated (two links of different allowed types between the same
 *  pair draw one arrow). Self-edges drop. */
export function dependencyEdges(
	visibleIds: ReadonlySet<string>,
	links: ReadonlyArray<DependencyLinkInput>,
	allowedTypes: ReadonlyArray<string>,
): DependencyEdge[] {
	if (allowedTypes.length === 0) return [];
	const allowed = new Set(allowedTypes);
	const seen = new Set<string>();
	const edges: DependencyEdge[] = [];
	for (const link of links) {
		if (!allowed.has(link.linkType)) continue;
		if (link.sourceEntityId === link.destEntityId) continue;
		if (!visibleIds.has(link.sourceEntityId) || !visibleIds.has(link.destEntityId)) continue;
		const key = `${link.sourceEntityId} -> ${link.destEntityId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push({ fromId: link.sourceEntityId, toId: link.destEntityId });
	}
	return edges;
}
