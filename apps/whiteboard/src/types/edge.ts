/**
 * `brainstorm/WhiteboardEdge/v1` — separate entity per OQ-WB-1
 * resolution. Each edge points between two nodes on a specific
 * whiteboard, anchored at compass handles (OQ-WB-2).
 *
 * **Whiteboard arrows are visual connectors, NOT typed semantic links.**
 * Per OQ-WB-3 tentative leaning they do not participate in the Graph
 * app's edge index — that boundary is preserved deliberately so the
 * Graph stays a query renderer over real typed links.
 */

export enum HandleSide {
	Top = "top",
	Right = "right",
	Bottom = "bottom",
	Left = "left",
}

/** All four sides in display order (clockwise from top). Frozen. */
export const HANDLE_SIDES: readonly HandleSide[] = Object.freeze([
	HandleSide.Top,
	HandleSide.Right,
	HandleSide.Bottom,
	HandleSide.Left,
]);

export enum EdgePathKind {
	Bezier = "bezier",
	Step = "step",
	Straight = "straight",
}

/** All three path kinds in display order — frozen. */
export const EDGE_PATH_KINDS: readonly EdgePathKind[] = Object.freeze([
	EdgePathKind.Bezier,
	EdgePathKind.Step,
	EdgePathKind.Straight,
]);

export enum ArrowHead {
	None = "none",
	Arrow = "arrow",
	Dot = "dot",
	Box = "box",
	Diamond = "diamond",
}

/** All five arrowhead kinds in display order — frozen. */
export const ARROW_HEADS: readonly ArrowHead[] = Object.freeze([
	ArrowHead.None,
	ArrowHead.Arrow,
	ArrowHead.Dot,
	ArrowHead.Box,
	ArrowHead.Diamond,
]);

/** Controlled connector-colour palette (9.17.16). The wire format stays a
 *  CSS string in `colorHint` (legacy-compatible), but the authoring UI only
 *  ever sets one of these so raw hex never leaks in from a menu. `Default`
 *  means "no override" — the renderer falls back to the theme `--edge`
 *  token, persisted as a `null` `colorHint`. */
export enum EdgeColor {
	Default = "default",
	Blue = "blue",
	Green = "green",
	Red = "red",
	Amber = "amber",
	Gray = "gray",
}

/** All connector colours in display order — frozen. */
export const EDGE_COLORS: readonly EdgeColor[] = Object.freeze([
	EdgeColor.Default,
	EdgeColor.Blue,
	EdgeColor.Green,
	EdgeColor.Red,
	EdgeColor.Amber,
	EdgeColor.Gray,
]);

const EDGE_COLOR_CSS: Readonly<Record<EdgeColor, string | null>> = Object.freeze({
	[EdgeColor.Default]: null,
	[EdgeColor.Blue]: "#3b82f6",
	[EdgeColor.Green]: "#22c55e",
	[EdgeColor.Red]: "#ef4444",
	[EdgeColor.Amber]: "#f59e0b",
	[EdgeColor.Gray]: "#94a3b8",
});

/** The persisted `colorHint` for a palette entry (`null` for `Default`). */
export function edgeColorToCss(c: EdgeColor): string | null {
	return EDGE_COLOR_CSS[c];
}

export type WhiteboardEdge = {
	id: string;
	/** Foreign key into `Whiteboard/v1`. */
	whiteboardId: string;
	sourceNodeId: string;
	sourceHandle: HandleSide;
	destNodeId: string;
	destHandle: HandleSide;
	pathKind: EdgePathKind;
	/** Arrowhead drawn at the dest end. */
	arrowHead: ArrowHead;
	/** Arrowhead drawn at the source end (9.17.16 bidirectional connectors).
	 *  Absent = unmarked source (the common single-direction connector). */
	sourceArrowHead?: ArrowHead;
	/** Dashed stroke (9.17.16); absent = solid. */
	dashed?: boolean;
	label: string | null;
	colorHint: string | null;
	createdAt: number;
	updatedAt: number;
};
