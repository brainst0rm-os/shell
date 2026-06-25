/**
 * `GraphView/v1` — a rendering of a Graph: layout kind, settings,
 * history-animation state. See and
 * .
 */

import type { Icon } from "./icon";
import type { EdgeDirection } from "./pattern";
import type { FilterNode } from "./predicate";

/* ── View kind discriminator ───────────────────────────────────────────── */

export enum GraphViewKind {
	Full = "full",
	Local = "local",
	Path = "path",
}

export enum LayoutKind {
	Force = "force",
	Radial = "radial",
	Hierarchy = "hierarchy",
	Circular = "circular",
	Grid = "grid",
}

/* ── Layout options (discriminated by view.kind) ───────────────────────── */

export type ForceParams = {
	charge: number;
	linkDistance: number;
	collisionRadius: number;
	centerStrength: number;
	velocityDecay: number;
};

export type LayoutOptionsFull = {
	kind: GraphViewKind.Full;
	layout: LayoutKind;
	forceParams: ForceParams | null;
	initialCenter: { entityId: string } | null;
};

export type LayoutOptionsLocal = {
	kind: GraphViewKind.Local;
	layout: LayoutKind;
	rootEntityId: string;
	depth: number;
	linkDirections: EdgeDirection[];
};

export enum PathAlgorithm {
	Shortest = "shortest",
	ShortestWeighted = "shortest-weighted",
	AllSimple = "all-simple",
}

export type LayoutOptionsPath = {
	kind: GraphViewKind.Path;
	fromEntityId: string;
	toEntityId: string;
	maxPaths: number;
	maxLength: number;
	algorithm: PathAlgorithm;
};

export type LayoutOptions = LayoutOptionsFull | LayoutOptionsLocal | LayoutOptionsPath;

/* ── Visibility ("Show on graph" section) ─────────────────────────────── */

export type GraphVisibility = {
	showLabels: boolean;
	showIcons: boolean;
	showArrows: boolean;
	showOrphans: boolean;
	showPreviewOnHover: boolean;
	clusterByType: boolean;
	hiddenTypes: string[];
	hiddenLinkTypes: string[];
};

/* ── Persistent settings (sizing, coloring, perf) ──────────────────────── */

export enum NodeSizing {
	Uniform = "uniform",
	ByDegree = "by-degree",
	ByRecency = "by-recency",
	ByProperty = "by-property",
}

export enum NodeColoring {
	ByType = "by-type",
	ByProperty = "by-property",
	ByCluster = "by-cluster",
	ByRecency = "by-recency",
	Uniform = "uniform",
}

export type LinkTypeStyle = {
	visible: boolean;
	color: string | null;
	width: number | null;
	arrowhead: "none" | "open" | "closed" | "double";
};

export type GraphSettings = {
	sizing: NodeSizing;
	nodeSizeProperty: string | null;
	coloring: NodeColoring;
	nodeColorProperty: string | null;
	showTypeEdges: boolean;
	edgeOpacity: number;
	webgl: boolean;
	highQuality: boolean;
	linkTypeOverrides: Record<string, LinkTypeStyle>;
};

/* ── History animation (temporal playback) ────────────────────────────── */

export enum HistoryReveal {
	Strict = "strict",
	Eased = "eased",
	Recent = "recent",
}

export type HistoryAnimationState = {
	enabled: boolean;
	startAt: number | null;
	endAt: number | null;
	cutoffAt: number | null;
	speed: number;
	reveal: HistoryReveal;
};

/* ── Camera policy on pattern recompute ────────────────────────────────── */

export enum CameraPolicy {
	Keep = "keep",
	Fit = "fit",
	CenterSelection = "centerSel",
}

/* ── Ordering for staggered appearance + history replay ────────────────── */

export enum SortDirection {
	Asc = "asc",
	Desc = "desc",
}

export type GraphOrderingKey = {
	key: "created" | "updated" | "degree" | "title" | `property:${string}`;
	direction: SortDirection;
};

export type GraphOrdering = {
	primary: GraphOrderingKey;
	secondary: GraphOrderingKey | null;
};

/* ── The entity ────────────────────────────────────────────────────────── */

export type GraphView = {
	id: string;
	graphId: string;
	name: string;
	icon: Icon | null;
	kind: GraphViewKind;
	layoutOptions: LayoutOptions;
	visibility: GraphVisibility;
	filterOverlay: FilterNode | null;
	ordering: GraphOrdering;
	settings: GraphSettings;
	history: HistoryAnimationState;
	cameraPolicy: CameraPolicy;
	/** `true` for the seeded built-in views (per
	 *  §Default views shipped with the app); cannot be deleted. */
	system?: boolean;
	createdAt: number;
	updatedAt: number;
};
