/**
 * `Graph/v1` — a saved configuration that selects a subset of the vault
 * (via `pattern`) and carries user overrides (pins, hides, highlights)
 * that survive pattern recomputation. See.
 */

import type { Icon } from "./icon";
import type { GraphPattern } from "./pattern";

/** Provenance for an override entry. `app:<id>` marks programmatic
 *  overrides set by third-party apps via intent.add-to-graph in v2. */
export type OverrideSource = "user" | `app:${string}`;

export type PinnedNode = {
	entityId: string;
	x: number;
	y: number;
	pinnedAt: number;
	by: OverrideSource;
};

export type HiddenNode = {
	entityId: string;
	hiddenAt: number;
	by: OverrideSource;
	reason?: string;
};

export type HighlightedEdge = {
	linkId: string;
	highlightedAt: number;
	by: OverrideSource;
	color: string | null;
	note?: string;
};

/** Per-Graph hard cap on `pins.length`, `hides.length`, and `highlights.length`.
 *  Matches the Database app's `MEMBERS_HARD_CAP` shape. */
export const GRAPH_OVERRIDES_HARD_CAP = 5000 as const;

/** Per-Graph hard cap on `views.length` */
export const GRAPH_VIEWS_HARD_CAP = 50 as const;

export type Graph = {
	id: string;
	name: string;
	icon: Icon | null;
	description: string;
	pattern: GraphPattern;
	pins: PinnedNode[];
	hides: HiddenNode[];
	highlights: HighlightedEdge[];
	views: string[];
	defaultViewId: string | null;
	/** `true` for the seeded built-in views (per OQ-GR-9-style "system" entities); cannot be deleted. */
	system?: boolean;
	createdAt: number;
	updatedAt: number;
};
